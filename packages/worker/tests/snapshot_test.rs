mod common;

use common::TestContext;
use serde_json::json;

#[tokio::test]
#[ignore]
async fn create_and_list_snapshots() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (snap_status, snap_body) = ctx.api("POST", &format!("/sandboxes/{id}/snapshots"), Some(json!({
        "name": "test-snapshot"
    }))).await;
    assert_eq!(snap_status, 200);

    let snap_inner = snap_body.get("body").unwrap_or(&snap_body);
    let snapshot_id = snap_inner["id"].as_str().expect("Snapshot must have id");

    let (list_status, list_body) = ctx.api("GET", &format!("/sandboxes/{id}/snapshots"), None).await;
    assert_eq!(list_status, 200);

    let list_inner = list_body.get("body").unwrap_or(&list_body);
    let snapshots = list_inner.get("snapshots")
        .and_then(|v| v.as_array())
        .expect("Snapshots list must be an array");
    let found = snapshots.iter().any(|s| {
        s.get("id").and_then(|v| v.as_str()) == Some(snapshot_id)
    });
    assert!(found, "Created snapshot should appear in list");

    let _ = ctx.api("DELETE", &format!("/snapshots/{snapshot_id}"), None).await;
    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn restore_from_snapshot() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (_, _) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "touch /workspace/marker"
    }))).await;

    let (snap_status, snap_body) = ctx.api("POST", &format!("/sandboxes/{id}/snapshots"), Some(json!({
        "name": "before-delete"
    }))).await;
    assert_eq!(snap_status, 200);
    let snap_inner = snap_body.get("body").unwrap_or(&snap_body);
    let snapshot_id = snap_inner["id"].as_str().expect("Snapshot must have id");

    let (_, _) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "rm -f /workspace/marker"
    }))).await;

    let (verify_status, verify_body) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "test -f /workspace/marker && echo exists || echo missing"
    }))).await;
    assert_eq!(verify_status, 200);
    let verify_inner = verify_body.get("body").unwrap_or(&verify_body);
    assert!(
        verify_inner["stdout"].as_str().unwrap_or("").contains("missing"),
        "Marker should be missing before restore"
    );

    let (restore_status, _) = ctx.api("POST", &format!("/sandboxes/{id}/snapshots/restore"), Some(json!({
        "snapshotId": snapshot_id
    }))).await;
    assert_eq!(restore_status, 200);

    let (check_status, check_body) = ctx.api("POST", &format!("/sandboxes/{id}/exec"), Some(json!({
        "command": "test -f /workspace/marker && echo exists || echo missing"
    }))).await;
    assert_eq!(check_status, 200);
    let check_inner = check_body.get("body").unwrap_or(&check_body);
    assert!(
        check_inner["stdout"].as_str().unwrap_or("").contains("exists"),
        "Marker should exist after restore"
    );

    let _ = ctx.api("DELETE", &format!("/snapshots/{snapshot_id}"), None).await;
    ctx.cleanup(&id).await;
}

#[tokio::test]
#[ignore]
async fn delete_snapshot() {
    let ctx = TestContext::new();
    let id = ctx.create_sandbox().await;

    let (snap_status, snap_body) = ctx.api("POST", &format!("/sandboxes/{id}/snapshots"), Some(json!({
        "name": "to-delete"
    }))).await;
    assert_eq!(snap_status, 200);
    let snap_inner = snap_body.get("body").unwrap_or(&snap_body);
    let snapshot_id = snap_inner["id"].as_str().expect("Snapshot must have id");

    let (del_status, _) = ctx.api("DELETE", &format!("/snapshots/{snapshot_id}"), None).await;
    assert_eq!(del_status, 200);

    let (list_status, list_body) = ctx.api("GET", &format!("/sandboxes/{id}/snapshots"), None).await;
    assert_eq!(list_status, 200);
    let list_inner = list_body.get("body").unwrap_or(&list_body);
    let empty = vec![];
    let snapshots = list_inner.get("snapshots")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let still_exists = snapshots.iter().any(|s| {
        s.get("id").and_then(|v| v.as_str()) == Some(snapshot_id)
    });
    assert!(!still_exists, "Deleted snapshot should not appear in list");

    ctx.cleanup(&id).await;
}
