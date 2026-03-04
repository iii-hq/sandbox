use iii_sandbox_sdk::{ClientConfig, HttpClient, SandboxError, SandboxInfo};

fn make_client(url: &str) -> HttpClient {
    HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap()
}

fn make_client_with_token(url: &str, token: &str) -> HttpClient {
    HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: Some(token.to_string()),
        timeout_ms: None,
    }).unwrap()
}

#[tokio::test]
async fn test_get_returns_parsed_json() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "items": [{
                    "id": "sbx-1",
                    "name": "test",
                    "image": "python:3.12-slim",
                    "status": "running",
                    "createdAt": 1000,
                    "expiresAt": 2000
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = make_client(&server.url());
    let result: iii_sandbox_sdk::SandboxListResponse =
        client.get("/sandbox/sandboxes").await.unwrap();
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].id, "sbx-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_post_with_body() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "sbx-new",
                "name": "created",
                "image": "node:20",
                "status": "running",
                "createdAt": 1000,
                "expiresAt": 2000
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = make_client(&server.url());
    let body = serde_json::json!({"image": "node:20"});
    let result: SandboxInfo = client.post("/sandbox/sandboxes", Some(&body)).await.unwrap();
    assert_eq!(result.id, "sbx-new");
    assert_eq!(result.image, "node:20");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_delete_request() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("DELETE", "/sandbox/sandboxes/sbx-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"deleted": "sbx-1"}).to_string())
        .create_async()
        .await;

    let client = make_client(&server.url());
    let result: serde_json::Value = client.delete("/sandbox/sandboxes/sbx-1").await.unwrap();
    assert_eq!(result["deleted"], "sbx-1");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_auth_token_header_is_sent() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes")
        .match_header("Authorization", "Bearer my-secret-token")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"items": []}).to_string())
        .create_async()
        .await;

    let client = make_client_with_token(&server.url(), "my-secret-token");
    let _result: iii_sandbox_sdk::SandboxListResponse =
        client.get("/sandbox/sandboxes").await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_http_error_returns_sandbox_error() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/missing")
        .with_status(400)
        .with_body("bad request")
        .create_async()
        .await;

    let client = make_client(&server.url());
    let result: Result<SandboxInfo, _> = client.get("/sandbox/sandboxes/missing").await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    match err {
        SandboxError::Http {
            method,
            status,
            body,
            ..
        } => {
            assert_eq!(method, "GET");
            assert_eq!(status, 400);
            assert_eq!(body, "bad request");
        }
        _ => panic!("expected Http error"),
    }
    mock.assert_async().await;
}

#[tokio::test]
async fn test_404_response() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/not-found")
        .with_status(404)
        .with_body("not found")
        .create_async()
        .await;

    let client = make_client(&server.url());
    let result: Result<SandboxInfo, _> = client.get("/sandbox/sandboxes/not-found").await;
    assert!(result.is_err());
    match result.unwrap_err() {
        SandboxError::Http { status, .. } => assert_eq!(status, 404),
        _ => panic!("expected Http error"),
    }
    mock.assert_async().await;
}

#[tokio::test]
async fn test_500_response() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes")
        .with_status(500)
        .with_body("internal server error")
        .create_async()
        .await;

    let client = make_client(&server.url());
    let body = serde_json::json!({"image": "python:3.12-slim"});
    let result: Result<SandboxInfo, _> = client.post("/sandbox/sandboxes", Some(&body)).await;
    assert!(result.is_err());
    match result.unwrap_err() {
        SandboxError::Http { status, body, .. } => {
            assert_eq!(status, 500);
            assert_eq!(body, "internal server error");
        }
        _ => panic!("expected Http error"),
    }
    mock.assert_async().await;
}
