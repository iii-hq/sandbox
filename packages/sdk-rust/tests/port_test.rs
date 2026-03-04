use std::sync::Arc;

use iii_sandbox::port::PortManager;
use iii_sandbox::{ClientConfig, HttpClient};

fn make_port(url: &str) -> PortManager {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    PortManager::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_expose_all_params() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/ports")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "containerPort": 8080,
                "hostPort": 9090,
                "protocol": "tcp",
                "state": "active"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_port(&server.url());
    let result = pm.expose(8080, Some(9090), Some("tcp")).await.unwrap();
    assert_eq!(result.container_port, 8080);
    assert_eq!(result.host_port, 9090);
    assert_eq!(result.protocol, "tcp");
    assert_eq!(result.state, "active");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_expose_container_port_only() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/ports")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "containerPort": 3000,
                "hostPort": 3000,
                "protocol": "tcp",
                "state": "active"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_port(&server.url());
    let result = pm.expose(3000, None, None).await.unwrap();
    assert_eq!(result.container_port, 3000);
    assert_eq!(result.host_port, 3000);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/ports")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "ports": [
                    {"containerPort": 8080, "hostPort": 9090, "protocol": "tcp", "state": "active"},
                    {"containerPort": 3000, "hostPort": 3000, "protocol": "tcp", "state": "active"}
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let pm = make_port(&server.url());
    let result = pm.list().await.unwrap();
    assert_eq!(result.ports.len(), 2);
    assert_eq!(result.ports[0].container_port, 8080);
    assert_eq!(result.ports[1].container_port, 3000);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_unexpose() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "DELETE",
            "/sandbox/sandboxes/sbx-1/ports?containerPort=8080",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"removed": 8080}).to_string())
        .create_async()
        .await;

    let pm = make_port(&server.url());
    let result = pm.unexpose(8080).await.unwrap();
    assert_eq!(result.removed, 8080);
    mock.assert_async().await;
}
