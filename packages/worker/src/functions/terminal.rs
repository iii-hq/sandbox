use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::container::LogOutput;
use futures_util::StreamExt;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::runtime::docker::DockerRuntime;
#[cfg(feature = "firecracker")]
use crate::runtime::firecracker::FirecrackerRuntime;
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

                    let channel = iii2.create_channel(None).await.map_err(|e| {
                        iii_sdk::IIIError::Handler(format!("Failed to create channel: {e}"))
                    })?;

                    let session_id = state::generate_id("term");
                    let container_name = format!("iii-sbx-{id}");
                    let backend_name = rt.backend().to_string();
                    let ch_writer_ref = channel.writer_ref.clone();
                    let ch_reader_ref = channel.reader_ref.clone();
                    let ch_writer = channel.writer;
                    let ch_reader = channel.reader;

                    let backend_session_id;

                    #[cfg(feature = "firecracker")]
                    {
                        if let Some(fc_rt) = rt.as_any().downcast_ref::<FirecrackerRuntime>() {
                            backend_session_id = create_fc_terminal(
                                fc_rt, id, &shell, cols, rows, ch_writer, ch_reader,
                            )
                            .await?;
                        } else {
                            let docker_rt = rt
                                .as_any()
                                .downcast_ref::<DockerRuntime>()
                                .ok_or_else(|| {
                                    iii_sdk::IIIError::Handler(
                                        "Unsupported runtime for terminal".into(),
                                    )
                                })?;
                            backend_session_id = create_docker_terminal(
                                docker_rt,
                                &container_name,
                                &shell,
                                cols,
                                rows,
                                ch_writer,
                                ch_reader,
                            )
                            .await?;
                        }
                    }

                    #[cfg(not(feature = "firecracker"))]
                    {
                        let docker_rt = rt
                            .as_any()
                            .downcast_ref::<DockerRuntime>()
                            .ok_or_else(|| {
                                iii_sdk::IIIError::Handler(
                                    "Terminal requires Docker runtime".into(),
                                )
                            })?;
                        backend_session_id = create_docker_terminal(
                            docker_rt,
                            &container_name,
                            &shell,
                            cols,
                            rows,
                            ch_writer,
                            ch_reader,
                        )
                        .await?;
                    }

                    let session = json!({
                        "sessionId": session_id,
                        "sandboxId": id,
                        "execId": backend_session_id,
                        "cols": cols,
                        "rows": rows,
                        "shell": shell,
                        "status": "running",
                        "backend": backend_name,
                        "createdAt": chrono::Utc::now().timestamp_millis() as u64,
                        "channel": {
                            "writer": ch_writer_ref,
                            "reader": ch_reader_ref,
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

                    let backend_str = session
                        .get("backend")
                        .and_then(|v| v.as_str())
                        .unwrap_or("docker");

                    resize_backend_session(&rt, backend_str, exec_id, id, cols, rows).await?;

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
        #[cfg(feature = "firecracker")]
        let rt = rt.clone();
        iii.register_function_with_description(
            "terminal::close",
            "Close a terminal session",
            move |input: Value| {
                let kv = kv.clone();
                #[cfg(feature = "firecracker")]
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

                    let session_key = format!("{id}:{session_id}");
                    let session: Value = kv
                        .get(scopes::TERMINAL, &session_key)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!(
                                "Terminal session not found: {session_id}"
                            ))
                        })?;

                    #[cfg(feature = "firecracker")]
                    {
                        let backend_str = session
                            .get("backend")
                            .and_then(|v| v.as_str())
                            .unwrap_or("docker");

                        if backend_str == "firecracker" {
                            let exec_id = session
                                .get("execId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");

                            if let Some(fc_rt) = rt.as_any().downcast_ref::<FirecrackerRuntime>() {
                                let vm_id = id.strip_prefix("iii-sbx-").unwrap_or(id);
                                if let Ok(agent) = fc_rt.agent_client(vm_id).await {
                                    let _ = agent.terminal_close(exec_id).await;
                                }
                            }
                        }
                    }

                    let _ = &session;

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

async fn create_docker_terminal(
    docker_rt: &DockerRuntime,
    container_name: &str,
    shell: &str,
    cols: u16,
    rows: u16,
    writer: iii_sdk::ChannelWriter,
    reader: iii_sdk::ChannelReader,
) -> Result<String, iii_sdk::IIIError> {
    let docker = docker_rt.docker_arc();

    let exec = docker
        .create_exec(
            container_name,
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
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to create exec: {e}")))?;

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

    let start_result = docker
        .start_exec(&exec_id, None)
        .await
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to start exec: {e}")))?;

    if let StartExecResults::Attached {
        mut output,
        input: exec_input,
    } = start_result
    {
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

    Ok(exec_id)
}

#[cfg(feature = "firecracker")]
async fn create_fc_terminal(
    fc_rt: &FirecrackerRuntime,
    sandbox_id: &str,
    shell: &str,
    cols: u16,
    rows: u16,
    writer: iii_sdk::ChannelWriter,
    reader: iii_sdk::ChannelReader,
) -> Result<String, iii_sdk::IIIError> {
    let vm_id = sandbox_id.strip_prefix("iii-sbx-").unwrap_or(sandbox_id);

    let agent = fc_rt
        .agent_client(vm_id)
        .await
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to get agent client: {e}")))?;

    let fc_session_id = agent
        .terminal_create(cols, rows, shell)
        .await
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to create FC terminal: {e}")))?;

    let read_agent = fc_rt
        .agent_client(vm_id)
        .await
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to get agent client: {e}")))?;
    let read_session = fc_session_id.clone();

    tokio::spawn(async move {
        loop {
            match read_agent.terminal_read(&read_session).await {
                Ok((data, eof)) => {
                    if !data.is_empty() && writer.write(&data).await.is_err() {
                        break;
                    }
                    if eof {
                        let _ = writer.close().await;
                        break;
                    }
                }
                Err(_) => {
                    let _ = writer.close().await;
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    });

    let write_agent = fc_rt
        .agent_client(vm_id)
        .await
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to get agent client: {e}")))?;
    let write_session = fc_session_id.clone();

    tokio::spawn(async move {
        while let Ok(Some(data)) = reader.next_binary().await {
            if write_agent
                .terminal_write(&write_session, &data)
                .await
                .is_err()
            {
                break;
            }
        }
    });

    Ok(fc_session_id)
}

async fn resize_backend_session(
    rt: &Arc<dyn SandboxRuntime>,
    backend_str: &str,
    exec_id: &str,
    _sandbox_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), iii_sdk::IIIError> {
    match backend_str {
        #[cfg(feature = "firecracker")]
        "firecracker" => {
            let fc_rt = rt
                .as_any()
                .downcast_ref::<FirecrackerRuntime>()
                .ok_or_else(|| {
                    iii_sdk::IIIError::Handler("Expected Firecracker runtime".into())
                })?;
            let vm_id = _sandbox_id
                .strip_prefix("iii-sbx-")
                .unwrap_or(_sandbox_id);
            let agent = fc_rt
                .agent_client(vm_id)
                .await
                .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to get agent: {e}")))?;
            agent
                .terminal_resize(exec_id, cols, rows)
                .await
                .map_err(|e| {
                    iii_sdk::IIIError::Handler(format!("Failed to resize FC terminal: {e}"))
                })?;
        }
        _ => {
            rt.resize_exec(exec_id, cols, rows)
                .await
                .map_err(|e| {
                    iii_sdk::IIIError::Handler(format!("Failed to resize exec: {e}"))
                })?;
        }
    }
    Ok(())
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
            "backend": "docker",
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
        assert_eq!(session["backend"], "docker");
        assert!(session.get("channel").is_some());
        assert!(session["channel"].get("writer").is_some());
        assert!(session["channel"].get("reader").is_some());
    }

    #[test]
    fn session_json_firecracker_backend() {
        let session = json!({
            "sessionId": "term_abc",
            "sandboxId": "sbx_1",
            "execId": "fc_sess_123",
            "cols": 80,
            "rows": 24,
            "shell": "/bin/sh",
            "status": "running",
            "backend": "firecracker",
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
        assert_eq!(session["backend"], "firecracker");
        assert_eq!(session["execId"], "fc_sess_123");
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

    #[test]
    fn backend_string_matching() {
        let docker_session = json!({ "backend": "docker" });
        let fc_session = json!({ "backend": "firecracker" });
        let no_backend = json!({ "status": "running" });

        assert_eq!(
            docker_session.get("backend").and_then(|v| v.as_str()).unwrap_or("docker"),
            "docker"
        );
        assert_eq!(
            fc_session.get("backend").and_then(|v| v.as_str()).unwrap_or("docker"),
            "firecracker"
        );
        assert_eq!(
            no_backend.get("backend").and_then(|v| v.as_str()).unwrap_or("docker"),
            "docker"
        );
    }

    #[test]
    fn strip_iii_sbx_prefix() {
        assert_eq!(
            "abc123".strip_prefix("iii-sbx-").unwrap_or("abc123"),
            "abc123"
        );
        assert_eq!(
            "iii-sbx-abc123".strip_prefix("iii-sbx-").unwrap_or("iii-sbx-abc123"),
            "abc123"
        );
    }
}
