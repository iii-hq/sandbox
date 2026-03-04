use std::sync::Arc;

use iii_sandbox_sdk::queue::{QueueManager, QueueSubmitOptions};
use iii_sandbox_sdk::{ClientConfig, HttpClient};

fn make_queue(url: &str) -> QueueManager {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    QueueManager::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_submit_command_only() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/exec/queue")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "job-1",
                "sandboxId": "sbx-1",
                "command": "echo test",
                "status": "queued",
                "result": null,
                "error": null,
                "retries": 0,
                "maxRetries": 3,
                "createdAt": 1000,
                "startedAt": null,
                "completedAt": null
            })
            .to_string(),
        )
        .create_async()
        .await;

    let q = make_queue(&server.url());
    let result = q.submit("echo test", None).await.unwrap();
    assert_eq!(result.id, "job-1");
    assert_eq!(result.command, "echo test");
    assert_eq!(result.status, "queued");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_submit_with_options() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/exec/queue")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "job-2",
                "sandboxId": "sbx-1",
                "command": "python train.py",
                "status": "queued",
                "result": null,
                "error": null,
                "retries": 0,
                "maxRetries": 5,
                "createdAt": 1000,
                "startedAt": null,
                "completedAt": null
            })
            .to_string(),
        )
        .create_async()
        .await;

    let q = make_queue(&server.url());
    let result = q
        .submit(
            "python train.py",
            Some(QueueSubmitOptions {
                max_retries: Some(5),
                timeout: Some(60000),
            }),
        )
        .await
        .unwrap();
    assert_eq!(result.id, "job-2");
    assert_eq!(result.max_retries, 5);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_status() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/queue/job-1/status")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "job-1",
                "sandboxId": "sbx-1",
                "command": "echo test",
                "status": "completed",
                "result": {"exitCode": 0, "stdout": "test\n", "stderr": "", "duration": 0.01},
                "error": null,
                "retries": 0,
                "maxRetries": 3,
                "createdAt": 1000,
                "startedAt": 1001,
                "completedAt": 1002
            })
            .to_string(),
        )
        .create_async()
        .await;

    let q = make_queue(&server.url());
    let result = q.status("job-1").await.unwrap();
    assert_eq!(result.status, "completed");
    assert!(result.result.is_some());
    assert_eq!(result.result.unwrap().exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_cancel() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/queue/job-1/cancel")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"cancelled": "job-1"}).to_string())
        .create_async()
        .await;

    let q = make_queue(&server.url());
    let result = q.cancel("job-1").await.unwrap();
    assert_eq!(result.cancelled, "job-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_dlq_no_limit() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/queue/dlq")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "jobs": [],
                "total": 0
            })
            .to_string(),
        )
        .create_async()
        .await;

    let q = make_queue(&server.url());
    let result = q.dlq(None).await.unwrap();
    assert!(result.jobs.is_empty());
    assert_eq!(result.total, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_dlq_with_limit() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/queue/dlq?limit=10")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "jobs": [{
                    "id": "job-fail",
                    "sandboxId": "sbx-1",
                    "command": "bad cmd",
                    "status": "failed",
                    "result": null,
                    "error": "command not found",
                    "retries": 3,
                    "maxRetries": 3,
                    "createdAt": 1000,
                    "startedAt": 1001,
                    "completedAt": 1002
                }],
                "total": 1
            })
            .to_string(),
        )
        .create_async()
        .await;

    let q = make_queue(&server.url());
    let result = q.dlq(Some(10)).await.unwrap();
    assert_eq!(result.jobs.len(), 1);
    assert_eq!(result.total, 1);
    assert_eq!(result.jobs[0].error, Some("command not found".to_string()));
    mock.assert_async().await;
}
