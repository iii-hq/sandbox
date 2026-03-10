use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::auth::{validate_chmod_mode, validate_path, validate_search_pattern};
use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

fn get_running_sandbox_name(id: &str) -> String {
    format!("iii-sbx-{id}")
}

async fn require_running(kv: &StateKV, id: &str) -> Result<String, iii_sdk::IIIError> {
    let sandbox: Sandbox = kv
        .get(scopes::SANDBOXES, id)
        .await
        .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
    if sandbox.status != "running" {
        return Err(iii_sdk::IIIError::Handler(format!(
            "Sandbox not running: {}",
            sandbox.status
        )));
    }
    Ok(get_running_sandbox_name(id))
}

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, config: &EngineConfig) {
    // fs::read
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::read", "Read file contents from sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("path is required".into()))?;
                validate_path(path, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                let cmd = vec!["cat".to_string(), path.to_string()];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Failed to read: {}", result.stderr)));
                }
                Ok(Value::String(result.stdout))
            }
        });
    }

    // fs::write
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::write", "Write file contents to sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("path is required".into()))?;
                let content = input.get("content").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("content is required".into()))?;
                validate_path(path, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                rt.copy_to_sandbox(&cn, path, content.as_bytes()).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                Ok(json!({ "success": true }))
            }
        });
    }

    // fs::delete
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::delete", "Delete a file in sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("path is required".into()))?;
                validate_path(path, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                let cmd = vec!["rm".to_string(), "-f".to_string(), path.to_string()];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Failed to delete: {}", result.stderr)));
                }
                Ok(json!({ "success": true }))
            }
        });
    }

    // fs::list
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::list", "List directory contents in sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let dir = input.get("path").and_then(|v| v.as_str()).unwrap_or(&cfg.workspace_dir);
                validate_path(dir, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                let files = rt.list_dir(&cn, dir).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                serde_json::to_value(&files).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // fs::search
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::search", "Search for files by glob pattern", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let pattern = input.get("pattern").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("pattern is required".into()))?;
                let dir = input.get("dir").and_then(|v| v.as_str()).unwrap_or(&cfg.workspace_dir);
                validate_path(dir, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                validate_search_pattern(pattern).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                let results = rt.search_files(&cn, dir, pattern).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                Ok(serde_json::to_value(&results).unwrap())
            }
        });
    }

    // fs::upload
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::upload", "Upload base64 file to sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("path is required".into()))?;
                let content = input.get("content").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("content is required".into()))?;
                validate_path(path, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(content)
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Invalid base64: {e}")))?;
                rt.copy_to_sandbox(&cn, path, &bytes).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                Ok(json!({ "success": true }))
            }
        });
    }

    // fs::download
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::download", "Download file as base64 from sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("path is required".into()))?;
                validate_path(path, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                let bytes = rt.copy_from_sandbox(&cn, path).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                use base64::Engine;
                let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                Ok(Value::String(encoded))
            }
        });
    }

    // fs::info
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::info", "Get file metadata and permissions", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let paths: Vec<String> = input.get("paths")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("paths is required".into()))?;
                for p in &paths {
                    validate_path(p, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                }
                let cn = require_running(&kv, id).await?;
                let metadata = rt.file_info(&cn, &paths).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                serde_json::to_value(&metadata).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // fs::move
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::move", "Move or rename files in sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let moves: Vec<Value> = input.get("moves")
                    .and_then(|v| v.as_array().cloned())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("moves is required".into()))?;
                let cn = require_running(&kv, id).await?;
                for m in &moves {
                    let from = m.get("from").and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("from is required".into()))?;
                    let to = m.get("to").and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("to is required".into()))?;
                    validate_path(from, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                    validate_path(to, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                    let cmd = vec!["mv".to_string(), from.to_string(), to.to_string()];
                    let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                        .map_err(iii_sdk::IIIError::Handler)?;
                    if result.exit_code != 0 {
                        return Err(iii_sdk::IIIError::Handler(format!("Move failed: {}", result.stderr)));
                    }
                }
                Ok(json!({ "success": true }))
            }
        });
    }

    // fs::mkdir
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::mkdir", "Create directories in sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let paths: Vec<String> = input.get("paths")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("paths is required".into()))?;
                let cn = require_running(&kv, id).await?;
                for p in &paths {
                    validate_path(p, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                    let cmd = vec!["mkdir".to_string(), "-p".to_string(), p.to_string()];
                    let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                        .map_err(iii_sdk::IIIError::Handler)?;
                    if result.exit_code != 0 {
                        return Err(iii_sdk::IIIError::Handler(format!("Mkdir failed: {}", result.stderr)));
                    }
                }
                Ok(json!({ "success": true }))
            }
        });
    }

    // fs::rmdir
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::rmdir", "Remove directories from sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let paths: Vec<String> = input.get("paths")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("paths is required".into()))?;
                let cn = require_running(&kv, id).await?;
                for p in &paths {
                    validate_path(p, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                    let cmd = vec!["rm".to_string(), "-rf".to_string(), p.to_string()];
                    let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                        .map_err(iii_sdk::IIIError::Handler)?;
                    if result.exit_code != 0 {
                        return Err(iii_sdk::IIIError::Handler(format!("Rmdir failed: {}", result.stderr)));
                    }
                }
                Ok(json!({ "success": true }))
            }
        });
    }

    // fs::chmod
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let cfg = config.clone();
        iii.register_function_with_description("fs::chmod", "Change file permissions in sandbox", move |input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("path is required".into()))?;
                let mode = input.get("mode").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("mode is required".into()))?;
                validate_path(path, &cfg.workspace_dir).map_err(iii_sdk::IIIError::Handler)?;
                validate_chmod_mode(mode).map_err(iii_sdk::IIIError::Handler)?;
                let cn = require_running(&kv, id).await?;
                let cmd = vec!["chmod".to_string(), mode.to_string(), path.to_string()];
                let result = rt.exec_in_sandbox(&cn, &cmd, 10000).await
                    .map_err(iii_sdk::IIIError::Handler)?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Chmod failed: {}", result.stderr)));
                }
                Ok(json!({ "success": true }))
            }
        });
    }
}
