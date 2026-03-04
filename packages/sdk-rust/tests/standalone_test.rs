use std::collections::HashMap;
use std::sync::Arc;

use iii_sandbox_sdk::events::EventHistoryOptions;
use iii_sandbox_sdk::observability::TraceOptions;
use iii_sandbox_sdk::{
    ClientConfig, EventManager, HttpClient, NetworkManager, ObservabilityClient, VolumeManager,
};

fn make_client(url: &str) -> Arc<HttpClient> {
    Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap())
}

#[tokio::test]
async fn test_event_history_with_filters() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "GET",
            "/sandbox/events/history?sandboxId=sbx-1&topic=exec&limit=10&offset=0",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "events": [
                    {
                        "id": "evt-1",
                        "topic": "exec",
                        "sandboxId": "sbx-1",
                        "data": {"command": "echo hi"},
                        "timestamp": 1000
                    }
                ],
                "total": 1
            })
            .to_string(),
        )
        .create_async()
        .await;

    let events = EventManager::new(make_client(&server.url()));
    let result = events
        .history(Some(EventHistoryOptions {
            sandbox_id: Some("sbx-1".into()),
            topic: Some("exec".into()),
            limit: Some(10),
            offset: Some(0),
        }))
        .await
        .unwrap();
    assert_eq!(result.events.len(), 1);
    assert_eq!(result.events[0].topic, "exec");
    assert_eq!(result.total, 1);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_event_history_no_filters() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/events/history")
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

    let events = EventManager::new(make_client(&server.url()));
    let result = events.history(None).await.unwrap();
    assert!(result.events.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_event_publish() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/events/publish")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "evt-2",
                "topic": "deploy",
                "sandboxId": "sbx-1",
                "data": {"version": "1.0"},
                "timestamp": 2000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let events = EventManager::new(make_client(&server.url()));
    let mut data = HashMap::new();
    data.insert(
        "version".to_string(),
        serde_json::Value::String("1.0".into()),
    );
    let result = events.publish("deploy", "sbx-1", Some(data)).await.unwrap();
    assert_eq!(result.id, "evt-2");
    assert_eq!(result.topic, "deploy");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_network_create() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/networks")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "net-1",
                "name": "my-network",
                "dockerNetworkId": "docker-abc",
                "sandboxes": [],
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let nm = NetworkManager::new(make_client(&server.url()));
    let result = nm.create("my-network", None).await.unwrap();
    assert_eq!(result.id, "net-1");
    assert_eq!(result.name, "my-network");
    assert!(result.sandboxes.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_network_create_with_driver() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/networks")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "net-2",
                "name": "overlay-net",
                "dockerNetworkId": "docker-def",
                "sandboxes": [],
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let nm = NetworkManager::new(make_client(&server.url()));
    let result = nm.create("overlay-net", Some("overlay")).await.unwrap();
    assert_eq!(result.id, "net-2");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_network_list() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/networks")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "networks": [
                    {
                        "id": "net-1",
                        "name": "default",
                        "dockerNetworkId": "docker-1",
                        "sandboxes": ["sbx-1"],
                        "createdAt": 1000
                    }
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let nm = NetworkManager::new(make_client(&server.url()));
    let result = nm.list().await.unwrap();
    assert_eq!(result.networks.len(), 1);
    assert_eq!(result.networks[0].sandboxes, vec!["sbx-1"]);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_network_connect() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/networks/net-1/connect")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"connected": true}).to_string())
        .create_async()
        .await;

    let nm = NetworkManager::new(make_client(&server.url()));
    let result = nm.connect("net-1", "sbx-1").await.unwrap();
    assert!(result.connected);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_network_disconnect() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/networks/net-1/disconnect")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"disconnected": true}).to_string())
        .create_async()
        .await;

    let nm = NetworkManager::new(make_client(&server.url()));
    let result = nm.disconnect("net-1", "sbx-1").await.unwrap();
    assert!(result.disconnected);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_network_delete() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("DELETE", "/sandbox/networks/net-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"deleted": "net-1"}).to_string())
        .create_async()
        .await;

    let nm = NetworkManager::new(make_client(&server.url()));
    let result = nm.delete("net-1").await.unwrap();
    assert_eq!(result.deleted, "net-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_observability_traces_with_filters() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "GET",
            "/sandbox/observability/traces?sandboxId=sbx-1&functionId=exec&limit=20",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "traces": [
                    {
                        "id": "trace-1",
                        "functionId": "exec",
                        "sandboxId": "sbx-1",
                        "duration": 0.5,
                        "status": "ok",
                        "error": null,
                        "timestamp": 1000
                    }
                ],
                "total": 1
            })
            .to_string(),
        )
        .create_async()
        .await;

    let obs = ObservabilityClient::new(make_client(&server.url()));
    let result = obs
        .traces(Some(TraceOptions {
            sandbox_id: Some("sbx-1".into()),
            function_id: Some("exec".into()),
            limit: Some(20),
        }))
        .await
        .unwrap();
    assert_eq!(result.traces.len(), 1);
    assert_eq!(result.traces[0].function_id, "exec");
    assert_eq!(result.total, 1);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_observability_traces_no_filters() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/observability/traces")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "traces": [],
                "total": 0
            })
            .to_string(),
        )
        .create_async()
        .await;

    let obs = ObservabilityClient::new(make_client(&server.url()));
    let result = obs.traces(None).await.unwrap();
    assert!(result.traces.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_observability_metrics() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/observability/metrics")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "totalRequests": 100,
                "totalErrors": 2,
                "avgDuration": 0.15,
                "p95Duration": 0.45,
                "activeSandboxes": 3,
                "functionCounts": {"exec": 50, "clone": 10}
            })
            .to_string(),
        )
        .create_async()
        .await;

    let obs = ObservabilityClient::new(make_client(&server.url()));
    let result = obs.metrics().await.unwrap();
    assert_eq!(result.total_requests, 100);
    assert_eq!(result.total_errors, 2);
    assert_eq!(result.active_sandboxes, 3);
    assert_eq!(*result.function_counts.get("exec").unwrap(), 50);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_observability_clear() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/observability/clear")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"cleared": 50}).to_string())
        .create_async()
        .await;

    let obs = ObservabilityClient::new(make_client(&server.url()));
    let result = obs.clear(None).await.unwrap();
    assert_eq!(result.cleared, 50);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_observability_clear_with_before() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/observability/clear")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"cleared": 30}).to_string())
        .create_async()
        .await;

    let obs = ObservabilityClient::new(make_client(&server.url()));
    let result = obs.clear(Some(5000)).await.unwrap();
    assert_eq!(result.cleared, 30);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_volume_create() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/volumes")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "vol-1",
                "name": "data-vol",
                "dockerVolumeName": "iii-vol-data-vol",
                "mountPath": null,
                "sandboxId": null,
                "size": null,
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let vm = VolumeManager::new(make_client(&server.url()));
    let result = vm.create("data-vol", None).await.unwrap();
    assert_eq!(result.id, "vol-1");
    assert_eq!(result.name, "data-vol");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_volume_create_with_driver() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/volumes")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "vol-2",
                "name": "nfs-vol",
                "dockerVolumeName": "iii-vol-nfs-vol",
                "mountPath": null,
                "sandboxId": null,
                "size": null,
                "createdAt": 1000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let vm = VolumeManager::new(make_client(&server.url()));
    let result = vm.create("nfs-vol", Some("nfs")).await.unwrap();
    assert_eq!(result.id, "vol-2");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_volume_list() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/volumes")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "volumes": [
                    {
                        "id": "vol-1",
                        "name": "data-vol",
                        "dockerVolumeName": "iii-vol-data-vol",
                        "mountPath": "/data",
                        "sandboxId": "sbx-1",
                        "size": "100MB",
                        "createdAt": 1000
                    }
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let vm = VolumeManager::new(make_client(&server.url()));
    let result = vm.list().await.unwrap();
    assert_eq!(result.volumes.len(), 1);
    assert_eq!(result.volumes[0].name, "data-vol");
    assert_eq!(result.volumes[0].mount_path, Some("/data".to_string()));
    mock.assert_async().await;
}

#[tokio::test]
async fn test_volume_delete() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("DELETE", "/sandbox/volumes/vol-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"deleted": "vol-1"}).to_string())
        .create_async()
        .await;

    let vm = VolumeManager::new(make_client(&server.url()));
    let result = vm.delete("vol-1").await.unwrap();
    assert_eq!(result.deleted, "vol-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_volume_attach() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/volumes/vol-1/attach")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "attached": true,
                "mountPath": "/workspace/data"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let vm = VolumeManager::new(make_client(&server.url()));
    let result = vm
        .attach("vol-1", "sbx-1", "/workspace/data")
        .await
        .unwrap();
    assert!(result.attached);
    assert_eq!(result.mount_path, "/workspace/data");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_volume_detach() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/volumes/vol-1/detach")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"detached": true}).to_string())
        .create_async()
        .await;

    let vm = VolumeManager::new(make_client(&server.url()));
    let result = vm.detach("vol-1").await.unwrap();
    assert!(result.detached);
    mock.assert_async().await;
}
