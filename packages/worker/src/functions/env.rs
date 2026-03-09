use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::docker::exec_in_container;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // env::get
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("env::get", "Get environment variable value", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let key = input.get("key").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("key is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["sh".into(), "-c".into(), format!("printenv \"{key}\"")];
                let result = exec_in_container(&dk, &cn, &cmd, 10000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                if result.exit_code != 0 {
                    return Ok(json!({ "key": key, "value": null, "exists": false }));
                }
                Ok(json!({ "key": key, "value": result.stdout.trim_end(), "exists": true }))
            }
        });
    }

    // env::set
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("env::set", "Set environment variables", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let vars: HashMap<String, String> = input.get("vars")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("vars is required".into()))?;
                if vars.is_empty() {
                    return Err(iii_sdk::IIIError::Handler("No variables provided".into()));
                }
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let env_lines: String = vars.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
                let escaped = env_lines.replace('\'', "'\\''");
                let cmd = vec!["sh".into(), "-c".into(), format!("printf '%s\\n' '{escaped}' >> /etc/environment")];
                exec_in_container(&dk, &cn, &cmd, 10000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;

                let keys: Vec<&String> = vars.keys().collect();
                Ok(json!({ "set": keys, "count": vars.len() }))
            }
        });
    }

    // env::list
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("env::list", "List all environment variables", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["sh".into(), "-c".into(), "env".into()];
                let result = exec_in_container(&dk, &cn, &cmd, 10000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Failed to list env: {}", result.stderr)));
                }
                let mut vars = HashMap::new();
                for line in result.stdout.trim().lines().filter(|l| !l.is_empty()) {
                    if let Some(eq_idx) = line.find('=') {
                        if eq_idx > 0 {
                            vars.insert(line[..eq_idx].to_string(), line[eq_idx+1..].to_string());
                        }
                    }
                }
                let count = vars.len();
                Ok(json!({ "vars": vars, "count": count }))
            }
        });
    }

    // env::delete
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("env::delete", "Delete an environment variable", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let key = input.get("key").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("key is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["sh".into(), "-c".into(), format!("sed -i '/^{key}=/d' /etc/environment")];
                exec_in_container(&dk, &cn, &cmd, 10000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                Ok(json!({ "deleted": key }))
            }
        });
    }
}
