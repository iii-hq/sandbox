mod common;

use common::TestContext;
use serde_json::json;

#[tokio::test]
#[ignore]
async fn write_and_read_file() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let content = "hello from integration test";
    let (write_status, _) = ctx.api("POST", &format!("/sandboxes/{id}/files/write"), Some(json!({
        "path": "/workspace/test.txt",
        "content": content
    }))).await;
    assert_eq!(write_status, 200);

    let (read_status, read_body) = ctx.api("POST", &format!("/sandboxes/{id}/files/read"), Some(json!({
        "path": "/workspace/test.txt"
    }))).await;
    assert_eq!(read_status, 200);

    let read_content = read_body.get("body")
        .and_then(|b| b.as_str())
        .unwrap_or_else(|| read_body.as_str().unwrap_or(""));
    assert!(
        read_content.contains(content),
        "Read content should match written content, got: {read_content}"
    );

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn list_directory() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (write_status, _) = ctx.api("POST", &format!("/sandboxes/{id}/files/write"), Some(json!({
        "path": "/workspace/listme.txt",
        "content": "data"
    }))).await;
    assert_eq!(write_status, 200);

    let (list_status, list_body) = ctx.api("POST", &format!("/sandboxes/{id}/files/list"), Some(json!({
        "path": "/workspace"
    }))).await;
    assert_eq!(list_status, 200);

    let inner = list_body.get("body").unwrap_or(&list_body);
    let listing = serde_json::to_string(inner).unwrap_or_default();
    assert!(
        listing.contains("listme.txt"),
        "Directory listing should include listme.txt, got: {listing}"
    );

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn delete_file() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (write_status, _) = ctx.api("POST", &format!("/sandboxes/{id}/files/write"), Some(json!({
        "path": "/workspace/deleteme.txt",
        "content": "to be deleted"
    }))).await;
    assert_eq!(write_status, 200);

    let (delete_status, _) = ctx.api("POST", &format!("/sandboxes/{id}/files/delete"), Some(json!({
        "path": "/workspace/deleteme.txt"
    }))).await;
    assert_eq!(delete_status, 200);

    let (read_status, read_body) = ctx.api("POST", &format!("/sandboxes/{id}/files/read"), Some(json!({
        "path": "/workspace/deleteme.txt"
    }))).await;
    let read_failed = read_status >= 400
        || read_body.get("body")
            .and_then(|b| b.get("error"))
            .is_some();
    assert!(
        read_failed,
        "Read after delete should fail, got status={read_status}, body={read_body}"
    );

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn file_metadata() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (write_status, _) = ctx.api("POST", &format!("/sandboxes/{id}/files/write"), Some(json!({
        "path": "/workspace/meta.txt",
        "content": "metadata test content"
    }))).await;
    assert_eq!(write_status, 200);

    let (info_status, info_body) = ctx.api("POST", &format!("/sandboxes/{id}/files/info"), Some(json!({
        "paths": ["/workspace/meta.txt"]
    }))).await;
    assert_eq!(info_status, 200);

    let inner = info_body.get("body").unwrap_or(&info_body);
    let info_str = serde_json::to_string(inner).unwrap_or_default();

    let has_size = inner.as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("size"))
        .and_then(|s| s.as_u64())
        .map(|s| s > 0)
        .unwrap_or(false)
        || info_str.contains("size");
    assert!(has_size, "File metadata should contain size > 0, got: {info_str}");

    let not_dir = inner.as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("isDirectory"))
        .and_then(|d| d.as_bool())
        .map(|d| !d)
        .unwrap_or(true);
    assert!(not_dir, "meta.txt should not be a directory");

    ctx.cleanup(&id).await;
}
