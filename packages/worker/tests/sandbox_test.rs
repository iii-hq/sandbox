mod common;

use common::TestContext;
use serde_json::json;

#[tokio::test]
#[ignore]
async fn create_sandbox_returns_id_and_status() {
    let ctx = TestContext::new();
    let (status, body) = ctx.api("POST", "/sandboxes", Some(json!({
        "image": "alpine:3.19",
        "timeout": 120
    }))).await;

    assert_eq!(status, 200);
    let inner = body.get("body").unwrap_or(&body);
    assert!(inner.get("id").is_some(), "Response must contain id");
    assert_eq!(inner.get("status").and_then(|v| v.as_str()), Some("running"));

    let id = inner["id"].as_str().unwrap();
    ctx.cleanup(id).await;
}

#[tokio::test]
#[ignore]
async fn get_sandbox_returns_details() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (status, body) = ctx.api("GET", &format!("/sandboxes/{id}"), None).await;
    assert_eq!(status, 200);
    let inner = body.get("body").unwrap_or(&body);
    assert_eq!(inner["id"].as_str(), Some(id.as_str()));
    assert!(inner.get("image").is_some());
    assert!(inner.get("createdAt").is_some());
    assert!(inner.get("expiresAt").is_some());
    assert!(inner.get("config").is_some());

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn list_sandboxes_includes_created() {
    let ctx = TestContext::new();
    let id1 = ctx.create_sandbox().await;
    let id2 = ctx.create_sandbox().await;

    let (status, body) = ctx.api("GET", "/sandboxes", None).await;
    assert_eq!(status, 200);
    let inner = body.get("body").unwrap_or(&body);
    let items = inner.get("items")
        .and_then(|v| v.as_array())
        .expect("items must be an array");

    let ids: Vec<&str> = items.iter()
        .filter_map(|i| i.get("id").and_then(|v| v.as_str()))
        .collect();
    assert!(ids.contains(&id1.as_str()), "List must contain first sandbox");
    assert!(ids.contains(&id2.as_str()), "List must contain second sandbox");

    ctx.cleanup(&id1).await;
    ctx.cleanup(&id2).await;
}

#[tokio::test]
#[ignore]
async fn kill_sandbox_removes_it() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (kill_status, _) = ctx.api("DELETE", &format!("/sandboxes/{id}"), None).await;
    assert_eq!(kill_status, 200);

    let (get_status, get_body) = ctx.api("GET", &format!("/sandboxes/{id}"), None).await;
    let is_gone = get_status == 404
        || get_body.get("body")
            .and_then(|b| b.get("error"))
            .and_then(|e| e.as_str())
            .map(|e| e.contains("not found"))
            .unwrap_or(false);
    assert!(is_gone, "Killed sandbox should not be found, got status={get_status}");
}

#[tokio::test]
#[ignore]
async fn pause_and_resume_sandbox() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (pause_status, pause_body) = ctx.api("POST", &format!("/sandboxes/{id}/pause"), None).await;
    assert_eq!(pause_status, 200);
    let pause_inner = pause_body.get("body").unwrap_or(&pause_body);
    assert_eq!(pause_inner["status"].as_str(), Some("paused"));

    let (resume_status, resume_body) = ctx.api("POST", &format!("/sandboxes/{id}/resume"), None).await;
    assert_eq!(resume_status, 200);
    let resume_inner = resume_body.get("body").unwrap_or(&resume_body);
    assert_eq!(resume_inner["status"].as_str(), Some("running"));

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn renew_extends_ttl() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (get_status, get_body) = ctx.api("GET", &format!("/sandboxes/{id}"), None).await;
    assert_eq!(get_status, 200);
    let original_expires = get_body.get("body")
        .unwrap_or(&get_body)
        .get("expiresAt")
        .and_then(|v| v.as_u64())
        .expect("expiresAt must exist");

    let new_expires = original_expires + 600_000;
    let (renew_status, renew_body) = ctx.api("POST", &format!("/sandboxes/{id}/renew"), Some(json!({
        "expiresAt": new_expires
    }))).await;
    assert_eq!(renew_status, 200);

    let renew_inner = renew_body.get("body").unwrap_or(&renew_body);
    let updated_expires = renew_inner.get("expiresAt").and_then(|v| v.as_u64())
        .expect("Renewed sandbox must have expiresAt");
    assert!(updated_expires > original_expires, "TTL should be extended");

    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn create_with_invalid_image_fails() {
    let ctx = TestContext::new();
    let (status, body) = ctx.api("POST", "/sandboxes", Some(json!({
        "image": "",
        "timeout": 60
    }))).await;

    let is_error = status >= 400
        || body.get("body")
            .and_then(|b| b.get("error"))
            .is_some();
    assert!(is_error, "Empty image should produce an error, got status={status}");
}
