use std::sync::Arc;

use iii_sandbox::filesystem::FileSystem;
use iii_sandbox::{ClientConfig, HttpClient};

fn make_fs(url: &str) -> FileSystem {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    FileSystem::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_read() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/read")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!("file contents here").to_string())
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    let content = fs.read("/workspace/main.py").await.unwrap();
    assert_eq!(content, "file contents here");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_write() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/write")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("{}")
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    fs.write("/workspace/main.py", "print('hello')").await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_delete() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/delete")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("{}")
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    fs.delete("/workspace/old.py").await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list_default_path() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/list")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!([
                {
                    "name": "main.py",
                    "path": "/workspace/main.py",
                    "size": 100,
                    "isDirectory": false,
                    "modifiedAt": 1000
                },
                {
                    "name": "src",
                    "path": "/workspace/src",
                    "size": 0,
                    "isDirectory": true,
                    "modifiedAt": 2000
                }
            ])
            .to_string(),
        )
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    let files = fs.list(None).await.unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].name, "main.py");
    assert!(!files[0].is_directory);
    assert!(files[1].is_directory);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list_custom_path() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/list")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!([
                {
                    "name": "lib.rs",
                    "path": "/workspace/src/lib.rs",
                    "size": 200,
                    "isDirectory": false,
                    "modifiedAt": 3000
                }
            ])
            .to_string(),
        )
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    let files = fs.list(Some("/workspace/src")).await.unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].name, "lib.rs");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_search() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/search")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!([
                "/workspace/main.py",
                "/workspace/test.py"
            ])
            .to_string(),
        )
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    let results = fs.search("*.py", None).await.unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], "/workspace/main.py");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_upload() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/upload")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("{}")
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    fs.upload("/workspace/data.csv", "a,b,c\n1,2,3")
        .await
        .unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_download() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/files/download")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!("downloaded content").to_string())
        .create_async()
        .await;

    let fs = make_fs(&server.url());
    let content = fs.download("/workspace/data.csv").await.unwrap();
    assert_eq!(content, "downloaded content");
    mock.assert_async().await;
}
