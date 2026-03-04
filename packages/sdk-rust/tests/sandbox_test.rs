use std::sync::Arc;

use iii_sandbox_sdk::{ClientConfig, HttpClient, Sandbox, SandboxInfo};

fn make_sandbox(url: &str) -> Sandbox {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    let info = SandboxInfo {
        id: "sbx-1".into(),
        name: "test".into(),
        image: "python:3.12-slim".into(),
        status: "running".into(),
        created_at: 1000,
        expires_at: 2000,
    };
    Sandbox::new(client, info)
}

#[tokio::test]
async fn test_exec() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/exec")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "hello\n",
                "stderr": "",
                "duration": 0.05
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let result = sbx.exec("echo hello", None).await.unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, "hello\n");
    assert_eq!(result.stderr, "");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_exec_with_timeout() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/exec")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "done",
                "stderr": "",
                "duration": 1.2
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let result = sbx.exec("sleep 1 && echo done", Some(5000)).await.unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, "done");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_clone_sandbox_with_name() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/clone")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "sbx-2",
                "name": "cloned",
                "image": "python:3.12-slim",
                "status": "running",
                "createdAt": 1000,
                "expiresAt": 2000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let cloned = sbx.clone_sandbox(Some("cloned")).await.unwrap();
    assert_eq!(cloned.id, "sbx-2");
    assert_eq!(cloned.name, "cloned");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_clone_sandbox_without_name() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/clone")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "sbx-3",
                "name": "auto-clone",
                "image": "python:3.12-slim",
                "status": "running",
                "createdAt": 1000,
                "expiresAt": 2000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let cloned = sbx.clone_sandbox(None).await.unwrap();
    assert_eq!(cloned.id, "sbx-3");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_pause() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/pause")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("{}")
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    sbx.pause().await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_resume() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/resume")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("{}")
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    sbx.resume().await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_kill() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("DELETE", "/sandbox/sandboxes/sbx-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("{}")
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    sbx.kill().await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_metrics() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/metrics")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "sandboxId": "sbx-1",
                "cpuPercent": 12.5,
                "memoryUsageMb": 128.0,
                "memoryLimitMb": 512.0,
                "networkRxBytes": 1024,
                "networkTxBytes": 2048,
                "pids": 5
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let metrics = sbx.metrics().await.unwrap();
    assert_eq!(metrics.sandbox_id, "sbx-1");
    assert_eq!(metrics.cpu_percent, 12.5);
    assert_eq!(metrics.memory_usage_mb, 128.0);
    assert_eq!(metrics.pids, 5);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_snapshot_with_name() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/snapshots")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "snap-1",
                "sandboxId": "sbx-1",
                "name": "my-snap",
                "imageId": "sha256:abc",
                "size": 1024,
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let snap = sbx.snapshot(Some("my-snap")).await.unwrap();
    assert_eq!(snap.id, "snap-1");
    assert_eq!(snap.name, "my-snap");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_snapshot_without_name() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/snapshots")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "snap-2",
                "sandboxId": "sbx-1",
                "name": "auto",
                "imageId": "sha256:def",
                "size": 2048,
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let snap = sbx.snapshot(None).await.unwrap();
    assert_eq!(snap.id, "snap-2");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_restore() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/snapshots/restore")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "sbx-1",
                "name": "test",
                "image": "python:3.12-slim",
                "status": "running",
                "createdAt": 1000,
                "expiresAt": 2000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let restored = sbx.restore("snap-1").await.unwrap();
    assert_eq!(restored.id, "sbx-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list_snapshots() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/snapshots")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "snapshots": [
                    {
                        "id": "snap-1",
                        "sandboxId": "sbx-1",
                        "name": "s1",
                        "imageId": "sha256:aaa",
                        "size": 512,
                        "createdAt": 1000
                    },
                    {
                        "id": "snap-2",
                        "sandboxId": "sbx-1",
                        "name": "s2",
                        "imageId": "sha256:bbb",
                        "size": 1024,
                        "createdAt": 2000
                    }
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let sbx = make_sandbox(&server.url());
    let list = sbx.list_snapshots().await.unwrap();
    assert_eq!(list.snapshots.len(), 2);
    assert_eq!(list.snapshots[0].id, "snap-1");
    assert_eq!(list.snapshots[1].id, "snap-2");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_refresh() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "sbx-1",
                "name": "test",
                "image": "python:3.12-slim",
                "status": "paused",
                "createdAt": 1000,
                "expiresAt": 2000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let mut sbx = make_sandbox(&server.url());
    assert_eq!(sbx.status(), "running");
    let updated = sbx.refresh().await.unwrap();
    assert_eq!(updated.status, "paused");
    assert_eq!(sbx.status(), "paused");
    mock.assert_async().await;
}
