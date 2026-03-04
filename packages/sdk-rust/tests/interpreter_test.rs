use std::sync::Arc;

use iii_sandbox::interpreter::CodeInterpreter;
use iii_sandbox::{ClientConfig, HttpClient};

fn make_interpreter(url: &str) -> CodeInterpreter {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    CodeInterpreter::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_run_default_language() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/interpret/execute")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "output": "42\n",
                "error": null,
                "executionTime": 0.01,
                "mimeType": null
            })
            .to_string(),
        )
        .create_async()
        .await;

    let interp = make_interpreter(&server.url());
    let result = interp.run("print(42)", None).await.unwrap();
    assert_eq!(result.output, "42\n");
    assert!(result.error.is_none());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_explicit_language() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/interpret/execute")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "output": "hello\n",
                "error": null,
                "executionTime": 0.02,
                "mimeType": null
            })
            .to_string(),
        )
        .create_async()
        .await;

    let interp = make_interpreter(&server.url());
    let result = interp
        .run("console.log('hello')", Some("javascript"))
        .await
        .unwrap();
    assert_eq!(result.output, "hello\n");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_with_error_result() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/interpret/execute")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "output": "",
                "error": "NameError: name 'x' is not defined",
                "executionTime": 0.005,
                "mimeType": null
            })
            .to_string(),
        )
        .create_async()
        .await;

    let interp = make_interpreter(&server.url());
    let result = interp.run("print(x)", None).await.unwrap();
    assert_eq!(result.output, "");
    assert_eq!(
        result.error,
        Some("NameError: name 'x' is not defined".to_string())
    );
    mock.assert_async().await;
}

#[tokio::test]
async fn test_install_pip() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/interpret/install")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "output": "Successfully installed requests-2.31.0"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let interp = make_interpreter(&server.url());
    let output = interp.install(&["requests"], None).await.unwrap();
    assert!(output.contains("Successfully installed"));
    mock.assert_async().await;
}

#[tokio::test]
async fn test_install_npm() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/interpret/install")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "output": "added 1 package"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let interp = make_interpreter(&server.url());
    let output = interp
        .install(&["express", "cors"], Some("npm"))
        .await
        .unwrap();
    assert_eq!(output, "added 1 package");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_kernels() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/interpret/kernels")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!([
                {"name": "python3", "language": "python", "displayName": "Python 3"},
                {"name": "node", "language": "javascript", "displayName": "Node.js"}
            ])
            .to_string(),
        )
        .create_async()
        .await;

    let interp = make_interpreter(&server.url());
    let kernels = interp.kernels().await.unwrap();
    assert_eq!(kernels.len(), 2);
    assert_eq!(kernels[0].name, "python3");
    assert_eq!(kernels[0].language, "python");
    assert_eq!(kernels[1].name, "node");
    mock.assert_async().await;
}
