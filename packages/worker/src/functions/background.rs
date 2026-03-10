use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::validate_command;
use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{BackgroundExec, Sandbox};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    // cmd::background
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("cmd::background", "Run a command in the background", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let command = input.get("command").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("command is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox not running: {}", sandbox.status)));
                }

                let exec_id = generate_id("bg");
                let shell_cmd = format!("({command}) > /tmp/{exec_id}.log 2>&1");
                let cmd = validate_command(&shell_cmd)
                    .map_err(iii_sdk::IIIError::Handler)?;

                let cn = format!("iii-sbx-{id}");
                let _ = rt.exec_detached(&cn, &cmd, false).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Exec failed: {e}")))?;

                let bg = BackgroundExec {
                    id: exec_id.clone(), sandbox_id: id.to_string(),
                    command: command.to_string(), pid: None,
                    running: true, exit_code: None,
                    started_at: now_ms(), finished_at: None,
                };
                kv.set(scopes::BACKGROUND, &exec_id, &bg).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&bg).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // cmd::background-status
    {
        let kv = kv.clone();
        iii.register_function_with_description("cmd::background-status", "Get background command status", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let bg: BackgroundExec = kv.get(scopes::BACKGROUND, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Background exec not found: {id}")))?;
                serde_json::to_value(&bg).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // cmd::background-logs
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("cmd::background-logs", "Get background command logs", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let cursor = input.get("cursor").and_then(|v| v.as_u64()).unwrap_or(0);

                let bg: BackgroundExec = kv.get(scopes::BACKGROUND, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Background exec not found: {id}")))?;

                let cn = format!("iii-sbx-{}", bg.sandbox_id);
                let log_file = format!("/tmp/{id}.log");
                let cmd = vec!["sh".into(), "-c".into(), format!("tail -c +{} {} 2>/dev/null || echo \"\"", cursor + 1, log_file)];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                let new_cursor = cursor + result.stdout.len() as u64;
                Ok(json!({ "output": result.stdout, "cursor": new_cursor }))
            }
        });
    }

    // cmd::interrupt
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("cmd::interrupt", "Send interrupt signal to a running command", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                let cn = format!("iii-sbx-{id}");
                let pid = input.get("pid").and_then(|v| v.as_u64());
                let cmd = if let Some(p) = pid {
                    vec!["kill".into(), "-SIGINT".into(), p.to_string()]
                } else {
                    vec!["pkill".into(), "-SIGINT".into(), "-f".into(), "sh -c".into()]
                };
                rt.exec_in_sandbox(&cn, &cmd, 5000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                Ok(json!({ "success": true }))
            }
        });
    }
}
