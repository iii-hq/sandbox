use std::collections::HashMap;
use std::sync::Arc;

use iii_sandbox_sdk::env::EnvManager;
use iii_sandbox_sdk::{ClientConfig, HttpClient};

fn make_env(url: &str) -> EnvManager {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    EnvManager::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_get_returns_value() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/env/get")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "key": "API_KEY",
                "value": "secret123",
                "exists": true
            })
            .to_string(),
        )
        .create_async()
        .await;

    let env = make_env(&server.url());
    let result = env.get("API_KEY").await.unwrap();
    assert_eq!(result.key, "API_KEY");
    assert_eq!(result.value, Some("secret123".to_string()));
    assert!(result.exists);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_get_returns_null_for_missing_key() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/env/get")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "key": "MISSING",
                "value": null,
                "exists": false
            })
            .to_string(),
        )
        .create_async()
        .await;

    let env = make_env(&server.url());
    let result = env.get("MISSING").await.unwrap();
    assert_eq!(result.key, "MISSING");
    assert!(result.value.is_none());
    assert!(!result.exists);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_set_with_multiple_vars() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/env")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "set": ["FOO", "BAR"],
                "count": 2
            })
            .to_string(),
        )
        .create_async()
        .await;

    let env = make_env(&server.url());
    let mut vars = HashMap::new();
    vars.insert("FOO".into(), "1".into());
    vars.insert("BAR".into(), "2".into());
    let result = env.set(vars).await.unwrap();
    assert_eq!(result.count, 2);
    assert_eq!(result.set.len(), 2);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/env")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "vars": {"PATH": "/usr/bin", "HOME": "/root"},
                "count": 2
            })
            .to_string(),
        )
        .create_async()
        .await;

    let env = make_env(&server.url());
    let result = env.list().await.unwrap();
    assert_eq!(result.count, 2);
    assert_eq!(result.vars.get("PATH").unwrap(), "/usr/bin");
    assert_eq!(result.vars.get("HOME").unwrap(), "/root");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_delete() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/env/delete")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"deleted": "OLD_VAR"}).to_string())
        .create_async()
        .await;

    let env = make_env(&server.url());
    let result = env.delete("OLD_VAR").await.unwrap();
    assert_eq!(result.deleted, "OLD_VAR");
    mock.assert_async().await;
}
