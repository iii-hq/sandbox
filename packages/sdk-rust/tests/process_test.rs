use std::sync::Arc;

use iii_sandbox_sdk::process::ProcessManager;
use iii_sandbox_sdk::{ClientConfig, HttpClient};

fn make_process(url: &str) -> ProcessManager {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    ProcessManager::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_list() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/processes")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "processes": [
                    {"pid": 1, "user": "root", "cpu": "0.1", "memory": "2.0", "command": "python"},
                    {"pid": 42, "user": "app", "cpu": "5.0", "memory": "10.0", "command": "node server.js"}
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_process(&server.url());
    let result = pm.list().await.unwrap();
    assert_eq!(result.processes.len(), 2);
    assert_eq!(result.processes[0].pid, 1);
    assert_eq!(result.processes[0].user, "root");
    assert_eq!(result.processes[1].command, "node server.js");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_kill_pid_only() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/processes/kill")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "killed": 42,
                "signal": "SIGTERM"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_process(&server.url());
    let result = pm.kill(42, None).await.unwrap();
    assert_eq!(result.killed, 42);
    assert_eq!(result.signal, "SIGTERM");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_kill_with_signal() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/processes/kill")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "killed": 99,
                "signal": "SIGKILL"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_process(&server.url());
    let result = pm.kill(99, Some("SIGKILL")).await.unwrap();
    assert_eq!(result.killed, 99);
    assert_eq!(result.signal, "SIGKILL");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_top() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/processes/top")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "processes": [
                    {"pid": 1, "cpu": "0.5", "mem": "1.2", "vsz": 100000, "rss": 50000, "command": "init"}
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_process(&server.url());
    let result = pm.top().await.unwrap();
    assert_eq!(result.processes.len(), 1);
    assert_eq!(result.processes[0].pid, 1);
    assert_eq!(result.processes[0].cpu, "0.5");
    assert_eq!(result.processes[0].rss, 50000);
    mock.assert_async().await;
}
