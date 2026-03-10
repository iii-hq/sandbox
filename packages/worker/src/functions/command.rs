use bollard::Docker;
use iii_sdk::III;
use serde_json::Value;
use std::sync::Arc;

use crate::auth::{check_auth, validate_command, validate_path};
use crate::config::EngineConfig;
use crate::docker::exec_in_container;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    // cmd::run
    {
        let kv = kv.clone();
        let dk = dk.clone();
        let cfg = config.clone();
        iii.register_function_with_description("cmd::run", "Execute a command in a sandbox", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let command = input.get("command").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("command is required".into()))?;

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let mut full_cmd = command.to_string();
                if let Some(cwd) = input.get("cwd").and_then(|v| v.as_str()) {
                    validate_path(cwd, &cfg.workspace_dir)
                        .map_err(iii_sdk::IIIError::Handler)?;
                    full_cmd = format!("cd \"{cwd}\" && {full_cmd}");
                }

                let cmd = validate_command(&full_cmd)
                    .map_err(iii_sdk::IIIError::Handler)?;

                let timeout_s = input.get("timeout").and_then(|v| v.as_u64()).unwrap_or(cfg.max_command_timeout);
                let timeout_ms = timeout_s.min(cfg.max_command_timeout) * 1000;

                let container_name = format!("iii-sbx-{id}");
                let result = exec_in_container(&dk, &container_name, &cmd, timeout_ms).await
                    .map_err(iii_sdk::IIIError::Handler)?;

                serde_json::to_value(&result).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // cmd::run-stream (registered as regular function, streaming handled via trigger)
    {
        let kv = kv.clone();
        let dk = dk.clone();
        let cfg = config.clone();
        iii.register_function_with_description("cmd::run-stream", "Execute a command with streaming output", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            let cfg = cfg.clone();
            async move {
                if let Some(auth_err) = check_auth(&input, &cfg) {
                    return Ok(auth_err);
                }
                let id = input.get("path_params")
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .or_else(|| input.get("id").and_then(|v| v.as_str()))
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;

                let body = input.get("body").unwrap_or(&input);
                let command = body.get("command").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("command is required".into()))?;

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let cmd = validate_command(command)
                    .map_err(iii_sdk::IIIError::Handler)?;

                let timeout_s = body.get("timeout").and_then(|v| v.as_u64()).unwrap_or(cfg.max_command_timeout);
                let timeout_ms = timeout_s.min(cfg.max_command_timeout) * 1000;

                let container_name = format!("iii-sbx-{id}");
                let result = exec_in_container(&dk, &container_name, &cmd, timeout_ms).await
                    .map_err(iii_sdk::IIIError::Handler)?;

                serde_json::to_value(&result).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }
}
