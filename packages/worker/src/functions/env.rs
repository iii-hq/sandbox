use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    // env::get
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("env::get", "Get environment variable value", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let key = input.get("key").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("key is required".into()))?;
                if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    return Err(iii_sdk::IIIError::Handler(format!("Invalid env key: {key}")));
                }
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["printenv".into(), key.to_string()];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                if result.exit_code != 0 {
                    return Ok(json!({ "key": key, "value": null, "exists": false }));
                }
                Ok(json!({ "key": key, "value": result.stdout.trim_end(), "exists": true }))
            }
        });
    }

    // env::set
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("env::set", "Set environment variables", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
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
                for key in vars.keys() {
                    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                        return Err(iii_sdk::IIIError::Handler(format!("Invalid env key: {key}")));
                    }
                }
                let env_lines: String = vars.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
                use base64::Engine;
                let encoded = base64::engine::general_purpose::STANDARD.encode(env_lines.as_bytes());
                let cmd = vec!["sh".into(), "-c".into(), format!("echo '{encoded}' | base64 -d >> /etc/environment")];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Failed to write env: {}", result.stderr)));
                }

                let keys: Vec<&String> = vars.keys().collect();
                Ok(json!({ "set": keys, "count": vars.len() }))
            }
        });
    }

    // env::list
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("env::list", "List all environment variables", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
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
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
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
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("env::delete", "Delete an environment variable", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
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
                if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    return Err(iii_sdk::IIIError::Handler("Invalid env key: must be alphanumeric/underscore".into()));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["sh".into(), "-c".into(), format!("sed -i '/^{key}=/d' /etc/environment")];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Failed to delete env: {}", result.stderr)));
                }
                Ok(json!({ "deleted": key }))
            }
        });
    }
}
