use std::sync::Arc;

use iii_sandbox_sdk::monitor::MonitorManager;
use iii_sandbox_sdk::{ClientConfig, HttpClient};

fn make_monitor(url: &str) -> MonitorManager {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    MonitorManager::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_set_alert() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/alerts")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "alert-1",
                "sandboxId": "sbx-1",
                "metric": "cpu",
                "threshold": 90.0,
                "action": "notify",
                "triggered": false,
                "lastChecked": null,
                "lastTriggered": null,
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let mon = make_monitor(&server.url());
    let result = mon.set_alert("cpu", 90.0, Some("notify")).await.unwrap();
    assert_eq!(result.id, "alert-1");
    assert_eq!(result.metric, "cpu");
    assert_eq!(result.threshold, 90.0);
    assert_eq!(result.action, "notify");
    assert!(!result.triggered);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_set_alert_default_action() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/alerts")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "alert-2",
                "sandboxId": "sbx-1",
                "metric": "memory",
                "threshold": 80.0,
                "action": "log",
                "triggered": false,
                "lastChecked": null,
                "lastTriggered": null,
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let mon = make_monitor(&server.url());
    let result = mon.set_alert("memory", 80.0, None).await.unwrap();
    assert_eq!(result.id, "alert-2");
    assert_eq!(result.metric, "memory");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list_alerts() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/alerts")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "alerts": [
                    {
                        "id": "alert-1",
                        "sandboxId": "sbx-1",
                        "metric": "cpu",
                        "threshold": 90.0,
                        "action": "notify",
                        "triggered": false,
                        "lastChecked": 5000,
                        "lastTriggered": null,
                        "createdAt": 1000
                    }
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let mon = make_monitor(&server.url());
    let result = mon.list_alerts().await.unwrap();
    assert_eq!(result.alerts.len(), 1);
    assert_eq!(result.alerts[0].metric, "cpu");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_delete_alert() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("DELETE", "/sandbox/alerts/alert-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"deleted": "alert-1"}).to_string())
        .create_async()
        .await;

    let mon = make_monitor(&server.url());
    let result = mon.delete_alert("alert-1").await.unwrap();
    assert_eq!(result.deleted, "alert-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_history_no_limit() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/alerts/history")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "events": [
                    {
                        "alertId": "alert-1",
                        "sandboxId": "sbx-1",
                        "metric": "cpu",
                        "value": 95.0,
                        "threshold": 90.0,
                        "action": "notify",
                        "timestamp": 5000
                    }
                ],
                "total": 1
            })
            .to_string(),
        )
        .create_async()
        .await;

    let mon = make_monitor(&server.url());
    let result = mon.history(None).await.unwrap();
    assert_eq!(result.events.len(), 1);
    assert_eq!(result.total, 1);
    assert_eq!(result.events[0].value, 95.0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_history_with_limit() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/alerts/history?limit=5")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "events": [],
                "total": 0
            })
            .to_string(),
        )
        .create_async()
        .await;

    let mon = make_monitor(&server.url());
    let result = mon.history(Some(5)).await.unwrap();
    assert!(result.events.is_empty());
    assert_eq!(result.total, 0);
    mock.assert_async().await;
}
