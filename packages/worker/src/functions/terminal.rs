use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::container::LogOutput;
use futures_util::StreamExt;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::runtime::docker::DockerRuntime;
use crate::state::{self, scopes, StateKV};
use crate::types::Sandbox;

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    // terminal::create
    {
        let kv = kv.clone();
        let rt = rt.clone();
        let iii2 = iii.clone();
        iii.register_function_with_description(
            "terminal::create",
            "Create an interactive terminal session with iii channel for PTY streaming",
            move |input: Value| {
                let kv = kv.clone();
                let rt = rt.clone();
                let iii2 = iii2.clone();
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
                    const ALLOWED_SHELLS: &[&str] =
                        &["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/ash"];
                    let shell = input
                        .get("shell")
                        .and_then(|v| v.as_str())
                        .unwrap_or("/bin/sh")
                        .to_string();
                    if !ALLOWED_SHELLS.contains(&shell.as_str()) {
                        return Err(iii_sdk::IIIError::Handler(format!(
                            "shell '{}' not allowed, use one of: {}",
                            shell,
                            ALLOWED_SHELLS.join(", ")
                        )));
                    }

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

                    let docker_rt = rt.as_any()
                        .downcast_ref::<DockerRuntime>()
                        .ok_or_else(|| iii_sdk::IIIError::Handler("Terminal requires Docker runtime".into()))?;
                    let docker = docker_rt.docker_arc();

                    let exec = docker
                        .create_exec(
                            &container_name,
                            CreateExecOptions {
                                cmd: Some(vec![shell.as_str()]),
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

                    let exec_id = exec.id.clone();

                    if cols != 80 || rows != 24 {
                        let _ = docker
                            .resize_exec(
                                &exec_id,
                                bollard::exec::ResizeExecOptions {
                                    height: rows,
                                    width: cols,
                                },
                            )
                            .await;
                    }

                    let channel = iii2.create_channel(None).await.map_err(|e| {
                        iii_sdk::IIIError::Handler(format!("Failed to create channel: {e}"))
                    })?;

                    let session_id = state::generate_id("term");

                    let session = json!({
                        "sessionId": session_id,
                        "sandboxId": id,
                        "execId": exec.id,
                        "cols": cols,
                        "rows": rows,
                        "shell": shell,
                        "status": "running",
                        "createdAt": chrono::Utc::now().timestamp_millis() as u64,
                        "channel": {
                            "writer": channel.writer_ref,
                            "reader": channel.reader_ref,
                        },
                    });

                    kv.set(
                        scopes::TERMINAL,
                        &format!("{id}:{session_id}"),
                        &session,
                    )
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

                    let start_result = docker
                        .start_exec(&exec_id, None)
                        .await
                        .map_err(|e| {
                            iii_sdk::IIIError::Handler(format!("Failed to start exec: {e}"))
                        })?;

                    if let StartExecResults::Attached {
                        mut output,
                        input: exec_input,
                    } = start_result
                    {
                        let writer = channel.writer;
                        let reader = channel.reader;

                        tokio::spawn(async move {
                            while let Some(Ok(msg)) = output.next().await {
                                let data = match msg {
                                    LogOutput::StdOut { message } => message,
                                    LogOutput::StdErr { message } => message,
                                    _ => continue,
                                };
                                if writer.write(&data).await.is_err() {
                                    break;
                                }
                            }
                            let _ = writer.close().await;
                        });

                        tokio::spawn(async move {
                            use tokio::io::AsyncWriteExt;
                            let mut stdin = exec_input;
                            while let Ok(Some(data)) = reader.next_binary().await {
                                if stdin.write_all(&data).await.is_err() {
                                    break;
                                }
                                if stdin.flush().await.is_err() {
                                    break;
                                }
                            }
                        });
                    }

                    Ok(session)
                }
            },
        );
    }

    // terminal::resize
    {
        let kv = kv.clone();
        let rt = rt.clone();
        iii.register_function_with_description(
            "terminal::resize",
            "Resize a terminal session",
            move |input: Value| {
                let kv = kv.clone();
                let rt = rt.clone();
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

                    let session_key = format!("{id}:{session_id}");
                    let session: Value = kv
                        .get(scopes::TERMINAL, &session_key)
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

                    rt.resize_exec(exec_id, cols, rows)
                        .await
                        .map_err(|e| {
                            iii_sdk::IIIError::Handler(format!("Failed to resize exec: {e}"))
                        })?;

                    let mut updated = session;
                    updated["cols"] = json!(cols);
                    updated["rows"] = json!(rows);
                    kv.set(scopes::TERMINAL, &session_key, &updated)
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

                    let session_key = format!("{id}:{session_id}");
                    let _session: Value = kv
                        .get(scopes::TERMINAL, &session_key)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!(
                                "Terminal session not found: {session_id}"
                            ))
                        })?;

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

                    kv.delete(scopes::TERMINAL, &session_key)
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
        let key = format!("{sandbox_id}:{session_id}");
        assert_eq!(key, "sbx_abc123:term_def456");
    }

    #[test]
    fn shell_allowlist_accepts_valid() {
        let allowed: &[&str] = &["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/ash"];
        assert!(allowed.contains(&"/bin/sh"));
        assert!(allowed.contains(&"/bin/bash"));
        assert!(allowed.contains(&"/bin/zsh"));
        assert!(allowed.contains(&"/bin/ash"));
    }

    #[test]
    fn shell_allowlist_rejects_invalid() {
        let allowed: &[&str] = &["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/ash"];
        assert!(!allowed.contains(&"/usr/bin/python3"));
        assert!(!allowed.contains(&"bash"));
        assert!(!allowed.contains(&"/bin/fish"));
    }

    #[test]
    fn terminal_scope_constant() {
        assert_eq!(scopes::TERMINAL, "terminal");
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
    fn session_json_with_channel_refs() {
        let session = json!({
            "sessionId": "term_abc",
            "sandboxId": "sbx_1",
            "execId": "exec_123",
            "cols": 80,
            "rows": 24,
            "shell": "/bin/sh",
            "status": "running",
            "createdAt": 1700000000000u64,
            "channel": {
                "writer": {
                    "channel_id": "ch_1",
                    "access_key": "key_w",
                    "direction": "write",
                },
                "reader": {
                    "channel_id": "ch_1",
                    "access_key": "key_r",
                    "direction": "read",
                },
            },
        });
        assert_eq!(session["status"], "running");
        assert!(session.get("channel").is_some());
        assert!(session["channel"].get("writer").is_some());
        assert!(session["channel"].get("reader").is_some());
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
