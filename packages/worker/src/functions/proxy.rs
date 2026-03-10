use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::state::{scopes, StateKV};
use crate::types::{PortMapping, Sandbox};

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    // proxy::request
    {
        let kv = kv.clone();
        let dk = dk.clone();
        iii.register_function_with_description(
            "proxy::request",
            "Forward HTTP request to a sandbox container port",
            move |input: Value| {
                let kv = kv.clone();
                let dk = dk.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                    let port = input
                        .get("port")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("port is required".into()))?
                        as u16;
                    let method = input
                        .get("method")
                        .and_then(|v| v.as_str())
                        .unwrap_or("GET");
                    let path = input
                        .get("path")
                        .and_then(|v| v.as_str())
                        .unwrap_or("/");
                    let headers = input
                        .get("headers")
                        .cloned()
                        .unwrap_or(json!({}));
                    let body = input
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    let sandbox: Sandbox = kv
                        .get(scopes::SANDBOXES, id)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}"))
                        })?;
                    if sandbox.status != "running" {
                        return Err(iii_sdk::IIIError::Handler(format!(
                            "Sandbox is not running: {}",
                            sandbox.status
                        )));
                    }

                    let ports: Vec<PortMapping> = sandbox
                        .metadata
                        .get("ports")
                        .and_then(|v| serde_json::from_str(v).ok())
                        .unwrap_or_default();
                    if !ports.iter().any(|p| p.container_port == port) {
                        return Err(iii_sdk::IIIError::Handler(format!(
                            "Port {port} is not exposed on sandbox {id}"
                        )));
                    }

                    let container_name = format!("iii-sbx-{id}");
                    let inspect = dk
                        .inspect_container(&container_name, None)
                        .await
                        .map_err(|e| {
                            iii_sdk::IIIError::Handler(format!(
                                "Failed to inspect container: {e}"
                            ))
                        })?;

                    let container_ip = inspect
                        .network_settings
                        .as_ref()
                        .and_then(|ns| ns.networks.as_ref())
                        .and_then(|nets| {
                            nets.values()
                                .next()
                                .and_then(|n| n.ip_address.as_deref())
                        })
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(
                                "Container has no IP address (network may be disabled)"
                                    .into(),
                            )
                        })?;

                    if container_ip.is_empty() {
                        return Err(iii_sdk::IIIError::Handler(
                            "Container has no IP address (network may be disabled)".into(),
                        ));
                    }

                    let url = format!("http://{container_ip}:{port}{path}");

                    let curl_cmd = build_curl_command(method, &url, &headers, body);

                    let result = crate::docker::exec_in_container(
                        &dk,
                        &container_name,
                        &curl_cmd,
                        30000,
                    )
                    .await
                    .map_err(|e| {
                        iii_sdk::IIIError::Handler(format!("Proxy request failed: {e}"))
                    })?;

                    Ok(json!({
                        "status": if result.exit_code == 0 { "success" } else { "error" },
                        "exitCode": result.exit_code,
                        "body": result.stdout,
                        "stderr": result.stderr,
                        "url": url,
                    }))
                }
            },
        );
    }

    // proxy::config
    {
        let kv = kv.clone();
        let config = config.clone();
        iii.register_function_with_description(
            "proxy::config",
            "Get or set proxy configuration for a sandbox",
            move |input: Value| {
                let kv = kv.clone();
                let config = config.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;

                    let mut sandbox: Sandbox = kv
                        .get(scopes::SANDBOXES, id)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}"))
                        })?;

                    if let Some(cors) = input.get("cors").and_then(|v| v.as_str()) {
                        sandbox
                            .metadata
                            .insert("proxy_cors".to_string(), cors.to_string());
                    }
                    if let Some(auth) = input.get("requireAuth").and_then(|v| v.as_bool()) {
                        sandbox
                            .metadata
                            .insert("proxy_auth".to_string(), auth.to_string());
                    }
                    if let Some(timeout) = input.get("timeout").and_then(|v| v.as_u64()) {
                        sandbox
                            .metadata
                            .insert("proxy_timeout".to_string(), timeout.to_string());
                    }

                    kv.set(scopes::SANDBOXES, id, &sandbox)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    let proxy_base = format!(
                        "{}/proxy/{id}",
                        config.api_prefix
                    );

                    Ok(json!({
                        "sandboxId": id,
                        "proxyBase": proxy_base,
                        "cors": sandbox.metadata.get("proxy_cors").unwrap_or(&"*".to_string()),
                        "requireAuth": sandbox.metadata.get("proxy_auth").unwrap_or(&"false".to_string()),
                        "timeout": sandbox.metadata.get("proxy_timeout").unwrap_or(&"30000".to_string()),
                    }))
                }
            },
        );
    }
}

fn build_curl_command(method: &str, url: &str, headers: &Value, body: &str) -> Vec<String> {
    let mut cmd = vec![
        "curl".to_string(),
        "-s".to_string(),
        "-S".to_string(),
        "-X".to_string(),
        method.to_string(),
    ];

    if let Some(obj) = headers.as_object() {
        for (k, v) in obj {
            if let Some(val) = v.as_str() {
                cmd.push("-H".to_string());
                cmd.push(format!("{k}: {val}"));
            }
        }
    }

    if !body.is_empty() && method != "GET" && method != "HEAD" {
        cmd.push("-d".to_string());
        cmd.push(body.to_string());
    }

    cmd.push("--max-time".to_string());
    cmd.push("30".to_string());
    cmd.push(url.to_string());
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_curl_get_simple() {
        let cmd = build_curl_command("GET", "http://localhost:3000/", &json!({}), "");
        assert_eq!(cmd[0], "curl");
        assert!(cmd.contains(&"GET".to_string()));
        assert!(cmd.contains(&"http://localhost:3000/".to_string()));
        assert!(!cmd.contains(&"-d".to_string()));
    }

    #[test]
    fn build_curl_post_with_body() {
        let cmd =
            build_curl_command("POST", "http://localhost:3000/api", &json!({}), "{\"key\":\"val\"}");
        assert!(cmd.contains(&"-d".to_string()));
        assert!(cmd.contains(&"{\"key\":\"val\"}".to_string()));
    }

    #[test]
    fn build_curl_with_headers() {
        let headers = json!({"Content-Type": "application/json", "X-Custom": "value"});
        let cmd = build_curl_command("GET", "http://localhost:3000/", &headers, "");
        assert!(cmd.contains(&"-H".to_string()));
        let header_count = cmd.iter().filter(|s| *s == "-H").count();
        assert_eq!(header_count, 2);
    }

    #[test]
    fn build_curl_get_ignores_body() {
        let cmd = build_curl_command("GET", "http://localhost:3000/", &json!({}), "some body");
        assert!(!cmd.contains(&"-d".to_string()));
    }

    #[test]
    fn build_curl_head_ignores_body() {
        let cmd = build_curl_command("HEAD", "http://localhost:3000/", &json!({}), "some body");
        assert!(!cmd.contains(&"-d".to_string()));
    }

    #[test]
    fn build_curl_has_max_time() {
        let cmd = build_curl_command("GET", "http://localhost:3000/", &json!({}), "");
        assert!(cmd.contains(&"--max-time".to_string()));
        assert!(cmd.contains(&"30".to_string()));
    }

    #[test]
    fn build_curl_put_with_body() {
        let cmd = build_curl_command("PUT", "http://localhost:3000/resource", &json!({}), "data");
        assert!(cmd.contains(&"-d".to_string()));
        assert!(cmd.contains(&"PUT".to_string()));
    }

    #[test]
    fn build_curl_silent_flag() {
        let cmd = build_curl_command("GET", "http://localhost:3000/", &json!({}), "");
        assert!(cmd.contains(&"-s".to_string()));
        assert!(cmd.contains(&"-S".to_string()));
    }

    #[test]
    fn proxy_url_format() {
        let container_ip = "172.17.0.2";
        let port = 3000u16;
        let path = "/api/data";
        let url = format!("http://{container_ip}:{port}{path}");
        assert_eq!(url, "http://172.17.0.2:3000/api/data");
    }

    #[test]
    fn proxy_url_root_path() {
        let container_ip = "172.17.0.2";
        let port = 8080u16;
        let path = "/";
        let url = format!("http://{container_ip}:{port}{path}");
        assert_eq!(url, "http://172.17.0.2:8080/");
    }

    #[test]
    fn default_method_is_get() {
        let input = json!({ "id": "sbx_1", "port": 3000 });
        let method = input
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET");
        assert_eq!(method, "GET");
    }

    #[test]
    fn default_path_is_root() {
        let input = json!({ "id": "sbx_1", "port": 3000 });
        let path = input
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("/");
        assert_eq!(path, "/");
    }

    #[test]
    fn port_validation_from_input() {
        let input = json!({ "id": "sbx_1", "port": 3000 });
        let port = input.get("port").and_then(|v| v.as_u64()).unwrap() as u16;
        assert_eq!(port, 3000);
    }
}
