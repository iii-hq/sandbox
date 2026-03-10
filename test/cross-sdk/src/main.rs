use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process;

#[derive(Deserialize)]
struct ScenarioFile {
    config: Config,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Config {
    base_url: String,
    api_prefix: String,
    auth_token: String,
    #[allow(dead_code)]
    image: String,
    #[allow(dead_code)]
    timeout: u64,
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    action: String,
    params: Option<HashMap<String, Value>>,
    expect: Option<HashMap<String, Value>>,
}

#[derive(Serialize)]
struct ScenarioResult {
    name: String,
    pass: bool,
    error: Option<String>,
}

struct RunContext {
    base_url: String,
    prefix: String,
    token: String,
    sandbox_id: String,
}

fn load_scenarios() -> ScenarioFile {
    let exe_path = env::current_exe().unwrap_or_default();
    let manifest_dir = exe_path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let scenario_path = if manifest_dir.join("scenario.json").exists() {
        manifest_dir.join("scenario.json")
    } else {
        PathBuf::from("scenario.json")
    };

    let raw = fs::read_to_string(&scenario_path)
        .unwrap_or_else(|_| panic!("Failed to read {}", scenario_path.display()));
    let mut data: ScenarioFile = serde_json::from_str(&raw).expect("Failed to parse scenario.json");

    if let Ok(url) = env::var("TEST_BASE_URL") {
        data.config.base_url = url;
    }
    if let Ok(token) = env::var("TEST_AUTH_TOKEN") {
        data.config.auth_token = token;
    }
    data
}

async fn http_post(client: &Client, base_url: &str, path: &str, token: &str, body: Option<Value>) -> Result<Value, String> {
    let url = format!("{}{}", base_url, path);
    let mut req = client.post(&url).header("Content-Type", "application/json");
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| format!("POST {}: {}", path, e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("POST {}: {} {}", path, status, text));
    }
    resp.json::<Value>().await.map_err(|e| format!("POST {} parse: {}", path, e))
}

async fn http_get(client: &Client, base_url: &str, path: &str, token: &str) -> Result<Value, String> {
    let url = format!("{}{}", base_url, path);
    let mut req = client.get(&url);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let resp = req.send().await.map_err(|e| format!("GET {}: {}", path, e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GET {}: {} {}", path, status, text));
    }
    resp.json::<Value>().await.map_err(|e| format!("GET {} parse: {}", path, e))
}

async fn http_delete(client: &Client, base_url: &str, path: &str, token: &str) -> Result<Value, String> {
    let url = format!("{}{}", base_url, path);
    let mut req = client.delete(&url);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let resp = req.send().await.map_err(|e| format!("DELETE {}: {}", path, e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("DELETE {}: {} {}", path, status, text));
    }
    resp.json::<Value>().await.map_err(|e| format!("DELETE {} parse: {}", path, e))
}

fn check_expect(result: &Value, expect: &HashMap<String, Value>, action: &str) -> Result<(), String> {
    for (key, val) in expect {
        match key.as_str() {
            "containsFile" => {
                let name = val.as_str().unwrap_or_default();
                let files = result.get("files").and_then(|f| f.as_array());
                let found = files.map_or(false, |arr| {
                    arr.iter().any(|f| f.get("name").and_then(|n| n.as_str()) == Some(name))
                });
                if !found {
                    return Err(format!("{}: expected files to contain '{}'", action, name));
                }
            }
            "containsKey" => {
                let k = val.as_str().unwrap_or_default();
                let vars = result.get("vars").and_then(|v| v.as_object());
                if !vars.map_or(false, |m| m.contains_key(k)) {
                    return Err(format!("{}: expected vars to contain key '{}'", action, k));
                }
            }
            "minCount" => {
                let min = val.as_u64().unwrap_or(0);
                let count = result
                    .get("snapshots")
                    .and_then(|s| s.as_array())
                    .map_or(0, |a| a.len() as u64);
                if count < min {
                    return Err(format!("{}: expected at least {} items, got {}", action, min, count));
                }
            }
            "success" => {}
            _ => {
                let actual = result.get(key);
                let expected_json = serde_json::to_string(val).unwrap_or_default();
                let actual_json = actual.map_or("null".to_string(), |a| serde_json::to_string(a).unwrap_or_default());
                if actual_json != expected_json {
                    return Err(format!("{}.{}: expected {}, got {}", action, key, expected_json, actual_json));
                }
            }
        }
    }
    Ok(())
}

async fn run_step(client: &Client, step: &Step, ctx: &mut RunContext) -> Result<(), String> {
    let params = step.params.as_ref();
    let prefix = &ctx.prefix;
    let base = &ctx.base_url;
    let token = &ctx.token;
    let sbx_id = &ctx.sandbox_id;
    let mut result = Value::Null;

    match step.action.as_str() {
        "create" => {
            let body = params.map(|p| serde_json::to_value(p).unwrap()).unwrap_or(json!({}));
            let data = http_post(client, base, &format!("{}/sandboxes", prefix), token, Some(body)).await?;
            ctx.sandbox_id = data.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            result = data;
        }
        "get" => {
            result = http_get(client, base, &format!("{}/sandboxes/{}", prefix, sbx_id), token).await?;
        }
        "exec" => {
            let p = params.ok_or("exec requires params")?;
            let mut body = json!({ "command": p.get("command").unwrap() });
            if let Some(wd) = p.get("workdir") {
                body["cwd"] = wd.clone();
            }
            result = http_post(client, base, &format!("{}/sandboxes/{}/exec", prefix, sbx_id), token, Some(body)).await?;
        }
        "pause" => {
            http_post(client, base, &format!("{}/sandboxes/{}/pause", prefix, sbx_id), token, None).await?;
            result = http_get(client, base, &format!("{}/sandboxes/{}", prefix, sbx_id), token).await?;
        }
        "resume" => {
            http_post(client, base, &format!("{}/sandboxes/{}/resume", prefix, sbx_id), token, None).await?;
            result = http_get(client, base, &format!("{}/sandboxes/{}", prefix, sbx_id), token).await?;
        }
        "kill" => {
            http_delete(client, base, &format!("{}/sandboxes/{}", prefix, sbx_id), token).await?;
            result = json!({ "success": true });
        }
        "fs-write" => {
            let p = params.ok_or("fs-write requires params")?;
            http_post(
                client, base,
                &format!("{}/sandboxes/{}/files/write", prefix, sbx_id),
                token,
                Some(json!({ "path": p["path"], "content": p["content"] })),
            ).await?;
        }
        "fs-read" => {
            let p = params.ok_or("fs-read requires params")?;
            let data = http_post(
                client, base,
                &format!("{}/sandboxes/{}/files/read", prefix, sbx_id),
                token,
                Some(json!({ "path": p["path"] })),
            ).await?;
            if data.is_string() {
                result = json!({ "content": data });
            } else {
                result = data;
            }
        }
        "fs-list" => {
            let p = params.ok_or("fs-list requires params")?;
            let data = http_post(
                client, base,
                &format!("{}/sandboxes/{}/files/list", prefix, sbx_id),
                token,
                Some(json!({ "path": p["path"] })),
            ).await?;
            result = json!({ "files": data });
        }
        "fs-delete" => {
            let p = params.ok_or("fs-delete requires params")?;
            http_post(
                client, base,
                &format!("{}/sandboxes/{}/files/delete", prefix, sbx_id),
                token,
                Some(json!({ "path": p["path"] })),
            ).await?;
        }
        "env-set" => {
            let p = params.ok_or("env-set requires params")?;
            let key = p["key"].as_str().unwrap_or_default();
            let value = p["value"].as_str().unwrap_or_default();
            http_post(
                client, base,
                &format!("{}/sandboxes/{}/env", prefix, sbx_id),
                token,
                Some(json!({ "vars": { key: value } })),
            ).await?;
        }
        "env-get" => {
            let p = params.ok_or("env-get requires params")?;
            result = http_post(
                client, base,
                &format!("{}/sandboxes/{}/env/get", prefix, sbx_id),
                token,
                Some(json!({ "key": p["key"] })),
            ).await?;
        }
        "env-list" => {
            result = http_get(client, base, &format!("{}/sandboxes/{}/env", prefix, sbx_id), token).await?;
        }
        "env-delete" => {
            let p = params.ok_or("env-delete requires params")?;
            http_post(
                client, base,
                &format!("{}/sandboxes/{}/env/delete", prefix, sbx_id),
                token,
                Some(json!({ "key": p["key"] })),
            ).await?;
        }
        "snapshot-create" => {
            let p = params.ok_or("snapshot-create requires params")?;
            result = http_post(
                client, base,
                &format!("{}/sandboxes/{}/snapshots", prefix, sbx_id),
                token,
                Some(json!({ "name": p["name"] })),
            ).await?;
        }
        "snapshot-list" => {
            result = http_get(client, base, &format!("{}/sandboxes/{}/snapshots", prefix, sbx_id), token).await?;
        }
        _ => return Err(format!("Unknown action: {}", step.action)),
    }

    if let Some(expect) = &step.expect {
        check_expect(&result, expect, &step.action)?;
    }

    Ok(())
}

async fn run_scenario(client: &Client, scenario: &Scenario, config: &Config) -> ScenarioResult {
    let mut ctx = RunContext {
        base_url: config.base_url.clone(),
        prefix: config.api_prefix.clone(),
        token: config.auth_token.clone(),
        sandbox_id: String::new(),
    };

    for step in &scenario.steps {
        if let Err(e) = run_step(client, step, &mut ctx).await {
            if !ctx.sandbox_id.is_empty() {
                let _ = http_delete(
                    client,
                    &ctx.base_url,
                    &format!("{}/sandboxes/{}", ctx.prefix, ctx.sandbox_id),
                    &ctx.token,
                ).await;
            }
            return ScenarioResult {
                name: scenario.name.clone(),
                pass: false,
                error: Some(e),
            };
        }
    }

    ScenarioResult {
        name: scenario.name.clone(),
        pass: true,
        error: None,
    }
}

#[tokio::main]
async fn main() {
    let data = load_scenarios();
    let client = Client::new();
    let mut results: Vec<ScenarioResult> = Vec::new();

    println!(
        "Running {} scenarios against {}\n",
        data.scenarios.len(),
        data.config.base_url
    );

    for scenario in &data.scenarios {
        let result = run_scenario(&client, scenario, &data.config).await;
        if result.pass {
            println!("[PASS] {}", result.name);
        } else {
            println!(
                "[FAIL] {}: {}",
                result.name,
                result.error.as_deref().unwrap_or("unknown")
            );
        }
        results.push(result);
    }

    let passed = results.iter().filter(|r| r.pass).count();
    let failed = results.iter().filter(|r| !r.pass).count();
    println!(
        "\n{} passed, {} failed out of {} scenarios",
        passed,
        failed,
        results.len()
    );

    if failed > 0 {
        process::exit(1);
    }
}
