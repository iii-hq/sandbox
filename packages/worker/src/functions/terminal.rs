use bollard::exec::CreateExecOptions;
use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::state::{self, scopes, StateKV};
use crate::types::Sandbox;

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // terminal::create
    {
        let kv = kv.clone();
        let dk = dk.clone();
        iii.register_function_with_description(
            "terminal::create",
            "Create an interactive terminal session (PTY exec)",
            move |input: Value| {
                let kv = kv.clone();
                let dk = dk.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                    let cols = input
                        .get("cols")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(80) as u16;
                    let rows = input
                        .get("rows")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(24) as u16;
                    let shell = input
                        .get("shell")
                        .and_then(|v| v.as_str())
                        .unwrap_or("/bin/sh");

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

                    let container_name = format!("iii-sbx-{id}");
                    let exec = dk
                        .create_exec(
                            &container_name,
                            CreateExecOptions {
                                cmd: Some(vec![shell]),
                                attach_stdin: Some(true),
                                attach_stdout: Some(true),
                                attach_stderr: Some(true),
                                tty: Some(true),
                                ..Default::default()
                            },
                        )
                        .await
                        .map_err(|e| {
                            iii_sdk::IIIError::Handler(format!("Failed to create exec: {e}"))
                        })?;

                    let session_id = state::generate_id("term");

                    let session = json!({
                        "sessionId": session_id,
                        "sandboxId": id,
                        "execId": exec.id,
                        "cols": cols,
                        "rows": rows,
                        "shell": shell,
                        "status": "created",
                        "createdAt": chrono::Utc::now().timestamp_millis() as u64,
                    });

                    kv.set(scopes::SANDBOXES, &format!("{id}:terminal:{session_id}"), &session)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    let mut sessions: Vec<String> = sandbox
                        .metadata
                        .get("terminal_sessions")
                        .and_then(|v| serde_json::from_str(v).ok())
                        .unwrap_or_default();
                    sessions.push(session_id.clone());

                    let mut updated_sandbox = sandbox;
                    updated_sandbox.metadata.insert(
                        "terminal_sessions".to_string(),
                        serde_json::to_string(&sessions).unwrap(),
                    );
                    kv.set(scopes::SANDBOXES, id, &updated_sandbox)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    Ok(session)
                }
            },
        );
    }

    // terminal::resize
    {
        let kv = kv.clone();
        let dk = dk.clone();
        iii.register_function_with_description(
            "terminal::resize",
            "Resize a terminal session",
            move |input: Value| {
                let kv = kv.clone();
                let dk = dk.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                    let session_id = input
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler("sessionId is required".into())
                        })?;
                    let cols = input
                        .get("cols")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("cols is required".into()))?
                        as u16;
                    let rows = input
                        .get("rows")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("rows is required".into()))?
                        as u16;

                    let session_key = format!("{id}:terminal:{session_id}");
                    let session: Value = kv
                        .get(scopes::SANDBOXES, &session_key)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!(
                                "Terminal session not found: {session_id}"
                            ))
                        })?;

                    let exec_id = session
                        .get("execId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler("execId missing from session".into())
                        })?;

                    dk.resize_exec(
                        exec_id,
                        bollard::exec::ResizeExecOptions {
                            height: rows,
                            width: cols,
                        },
                    )
                    .await
                    .map_err(|e| {
                        iii_sdk::IIIError::Handler(format!("Failed to resize exec: {e}"))
                    })?;

                    let mut updated = session;
                    updated["cols"] = json!(cols);
                    updated["rows"] = json!(rows);
                    kv.set(scopes::SANDBOXES, &session_key, &updated)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    Ok(json!({ "cols": cols, "rows": rows }))
                }
            },
        );
    }

    // terminal::close
    {
        let kv = kv.clone();
        iii.register_function_with_description(
            "terminal::close",
            "Close a terminal session",
            move |input: Value| {
                let kv = kv.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                    let session_id = input
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler("sessionId is required".into())
                        })?;

                    let session_key = format!("{id}:terminal:{session_id}");
                    let _session: Value = kv
                        .get(scopes::SANDBOXES, &session_key)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!(
                                "Terminal session not found: {session_id}"
                            ))
                        })?;

                    kv.delete(scopes::SANDBOXES, &session_key)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    let mut sandbox: Sandbox = kv
                        .get(scopes::SANDBOXES, id)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}"))
                        })?;
                    let mut sessions: Vec<String> = sandbox
                        .metadata
                        .get("terminal_sessions")
                        .and_then(|v| serde_json::from_str(v).ok())
                        .unwrap_or_default();
                    sessions.retain(|s| s != session_id);
                    sandbox.metadata.insert(
                        "terminal_sessions".to_string(),
                        serde_json::to_string(&sessions).unwrap(),
                    );
                    kv.set(scopes::SANDBOXES, id, &sandbox)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    Ok(json!({ "closed": session_id }))
                }
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_has_term_prefix() {
        let id = state::generate_id("term");
        assert!(id.starts_with("term_"));
    }

    #[test]
    fn session_id_correct_length() {
        let id = state::generate_id("term");
        assert_eq!(id.len(), 29);
    }

    #[test]
    fn session_key_format() {
        let sandbox_id = "sbx_abc123";
        let session_id = "term_def456";
        let key = format!("{sandbox_id}:terminal:{session_id}");
        assert_eq!(key, "sbx_abc123:terminal:term_def456");
    }

    #[test]
    fn default_cols_rows() {
        let input = json!({ "id": "sbx_1" });
        let cols = input.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
        let rows = input.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
        assert_eq!(cols, 80);
        assert_eq!(rows, 24);
    }

    #[test]
    fn custom_cols_rows() {
        let input = json!({ "id": "sbx_1", "cols": 120, "rows": 40 });
        let cols = input.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
        let rows = input.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
        assert_eq!(cols, 120);
        assert_eq!(rows, 40);
    }

    #[test]
    fn default_shell() {
        let input = json!({ "id": "sbx_1" });
        let shell = input
            .get("shell")
            .and_then(|v| v.as_str())
            .unwrap_or("/bin/sh");
        assert_eq!(shell, "/bin/sh");
    }

    #[test]
    fn custom_shell() {
        let input = json!({ "id": "sbx_1", "shell": "/bin/bash" });
        let shell = input
            .get("shell")
            .and_then(|v| v.as_str())
            .unwrap_or("/bin/sh");
        assert_eq!(shell, "/bin/bash");
    }

    #[test]
    fn session_json_structure() {
        let session = json!({
            "sessionId": "term_abc",
            "sandboxId": "sbx_1",
            "execId": "exec_123",
            "cols": 80,
            "rows": 24,
            "shell": "/bin/sh",
            "status": "created",
            "createdAt": 1700000000000u64,
        });
        assert_eq!(session["sessionId"], "term_abc");
        assert_eq!(session["cols"], 80);
        assert_eq!(session["rows"], 24);
        assert_eq!(session["status"], "created");
    }

    #[test]
    fn sessions_list_tracking() {
        let mut sessions: Vec<String> = vec!["term_1".to_string(), "term_2".to_string()];
        sessions.push("term_3".to_string());
        assert_eq!(sessions.len(), 3);
        sessions.retain(|s| s != "term_2");
        assert_eq!(sessions.len(), 2);
        assert!(!sessions.contains(&"term_2".to_string()));
    }
}
