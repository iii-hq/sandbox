mod common;

use common::TestContext;
use serde_json::json;

#[tokio::test]
#[ignore]
async fn exec_simple_command() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (status, body) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "echo hello"
    }))).await;
    assert_eq!(status, 200);

    let inner = body.get("body").unwrap_or(&body);
    assert_eq!(inner["exitCode"].as_i64(), Some(0));
    let stdout = inner["stdout"].as_str().unwrap_or("");
    assert!(stdout.contains("hello"), "stdout should contain 'hello', got: {stdout}");

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn exec_failing_command() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (status, body) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "exit 1"
    }))).await;
    assert_eq!(status, 200);

    let inner = body.get("body").unwrap_or(&body);
    let exit_code = inner["exitCode"].as_i64().unwrap_or(-999);
    assert_ne!(exit_code, 0, "exit code should be non-zero for failing command");

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn exec_with_stderr() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (status, body) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "echo err >&2"
    }))).await;
    assert_eq!(status, 200);

    let inner = body.get("body").unwrap_or(&body);
    let stderr = inner["stderr"].as_str().unwrap_or("");
    assert!(stderr.contains("err"), "stderr should contain 'err', got: {stderr}");

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn exec_with_workdir() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (status, body) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "pwd",
        "cwd": "/tmp"
    }))).await;
    assert_eq!(status, 200);

    let inner = body.get("body").unwrap_or(&body);
    let stdout = inner["stdout"].as_str().unwrap_or("");
    assert!(stdout.contains("/tmp"), "pwd output should contain '/tmp', got: {stdout}");

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn exec_background_command() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (status, body) = ctx.api("POST", &format!("/sandboxes/{id}/exec/background"), Some(json!({
        "command": "sleep 100"
    }))).await;
    assert_eq!(status, 200);

    let inner = body.get("body").unwrap_or(&body);
    assert!(inner.get("id").is_some(), "Background exec should return an id");
    assert_eq!(inner["running"].as_bool(), Some(true));

    ctx.cleanup(&id).await;
}
