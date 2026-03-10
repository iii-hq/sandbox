mod common;

use common::TestContext;
use serde_json::json;

#[tokio::test]
#[ignore]
async fn create_and_list_networks() {
    let ctx = TestContext::new();

    let (create_status, create_body) = ctx.api("POST", "/networks", Some(json!({
        "name": "integ-test-net"
    }))).await;
    assert_eq!(create_status, 200);

    let create_inner = create_body.get("body").unwrap_or(&create_body);
    let network_id = create_inner["id"].as_str().expect("Network must have id");

    let (list_status, list_body) = ctx.api("GET", "/networks", None).await;
    assert_eq!(list_status, 200);

    let list_inner = list_body.get("body").unwrap_or(&list_body);
    let networks = list_inner.get("networks")
        .and_then(|v| v.as_array())
        .expect("Networks list must be an array");
    let found = networks.iter().any(|n| {
        n.get("id").and_then(|v| v.as_str()) == Some(network_id)
    });
    assert!(found, "Created network should appear in list");

    let _ = ctx.api("DELETE", &format!("/networks/{network_id}"), None).await;
}

#[tokio::test]
#[ignore]
async fn connect_sandbox_to_network() {
    let ctx = TestContext::new();
    let sandbox_id = ctx.create_sandbox().await;

    let (create_status, create_body) = ctx.api("POST", "/networks", Some(json!({
        "name": "integ-connect-net"
    }))).await;
    assert_eq!(create_status, 200);
    let create_inner = create_body.get("body").unwrap_or(&create_body);
    let network_id = create_inner["id"].as_str().expect("Network must have id");

    let (connect_status, connect_body) = ctx.api(
        "POST",
        &format!("/networks/{network_id}/connect"),
        Some(json!({ "sandboxId": sandbox_id }))
    ).await;
    assert_eq!(connect_status, 200);
    let connect_inner = connect_body.get("body").unwrap_or(&connect_body);
    assert_eq!(connect_inner["connected"].as_bool(), Some(true));

    let _ = ctx.api("DELETE", &format!("/networks/{network_id}"), None).await;
    ctx.cleanup(&sandbox_id).await;
}

#[tokio::test]
#[ignore]
async fn delete_network() {
    let ctx = TestContext::new();

    let (create_status, create_body) = ctx.api("POST", "/networks", Some(json!({
        "name": "integ-delete-net"
    }))).await;
    assert_eq!(create_status, 200);
    let create_inner = create_body.get("body").unwrap_or(&create_body);
    let network_id = create_inner["id"].as_str().expect("Network must have id");

    let (del_status, _) = ctx.api("DELETE", &format!("/networks/{network_id}"), None).await;
    assert_eq!(del_status, 200);

    let (list_status, list_body) = ctx.api("GET", "/networks", None).await;
    assert_eq!(list_status, 200);
    let list_inner = list_body.get("body").unwrap_or(&list_body);
    let empty = vec![];
    let networks = list_inner.get("networks")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let still_exists = networks.iter().any(|n| {
        n.get("id").and_then(|v| v.as_str()) == Some(network_id)
    });
    assert!(!still_exists, "Deleted network should not appear in list");
}
