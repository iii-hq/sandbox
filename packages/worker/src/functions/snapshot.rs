use bollard::container::RemoveContainerOptions;
use bollard::image::CommitContainerOptions;
use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::docker::create_container;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, Snapshot};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // snapshot::create
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("snapshot::create", "Create a snapshot of sandbox state", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let name = input.get("name").and_then(|v| v.as_str());

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status == "stopped" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is stopped: {id}")));
                }

                let snapshot_id = generate_id("snap");
                let cn = format!("iii-sbx-{id}");
                let opts = CommitContainerOptions {
                    container: cn,
                    repo: format!("iii-sbx-snap-{snapshot_id}"),
                    comment: name.unwrap_or(&snapshot_id).to_string(),
                    ..Default::default()
                };
                let commit = dk.commit_container(opts, bollard::container::Config::<String>::default()).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Commit failed: {e}")))?;

                let image_id = commit.id.unwrap_or_default();
                let size = dk.inspect_image(&image_id).await
                    .map(|i| i.size.unwrap_or(0) as u64)
                    .unwrap_or(0);

                let snapshot = Snapshot {
                    id: snapshot_id.clone(),
                    sandbox_id: id.to_string(),
                    name: name.unwrap_or(&snapshot_id).to_string(),
                    image_id: image_id.clone(),
                    size,
                    created_at: now_ms(),
                };
                kv.set(scopes::SNAPSHOTS, &snapshot_id, &snapshot).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&snapshot).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // snapshot::restore
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("snapshot::restore", "Restore sandbox from snapshot", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let snapshot_id = input.get("snapshotId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("snapshotId is required".into()))?;

                let snapshot: Snapshot = kv.get(scopes::SNAPSHOTS, snapshot_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Snapshot not found: {snapshot_id}")))?;
                let mut sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let cn = format!("iii-sbx-{id}");
                let _ = dk.stop_container(&cn, None).await;
                let _ = dk.remove_container(&cn, Some(RemoveContainerOptions { force: true, ..Default::default() })).await;

                let mut restored_config = sandbox.config.clone();
                restored_config.image = snapshot.image_id.clone();
                create_container(&dk, id, &restored_config, sandbox.entrypoint.as_deref()).await
                    .map_err(iii_sdk::IIIError::Handler)?;

                sandbox.status = "running".to_string();
                sandbox.image = snapshot.image_id.clone();
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // snapshot::list
    {
        let kv = kv.clone();
        iii.register_function_with_description("snapshot::list", "List snapshots for a sandbox", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let all: Vec<Snapshot> = kv.list(scopes::SNAPSHOTS).await;
                let filtered: Vec<&Snapshot> = all.iter().filter(|s| s.sandbox_id == id).collect();
                Ok(json!({ "snapshots": filtered }))
            }
        });
    }

    // snapshot::delete
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("snapshot::delete", "Delete a snapshot", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let snapshot_id = input.get("snapshotId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("snapshotId is required".into()))?;
                let snapshot: Snapshot = kv.get(scopes::SNAPSHOTS, snapshot_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Snapshot not found: {snapshot_id}")))?;
                let _ = dk.remove_image(&snapshot.image_id, None, None).await;
                kv.delete(scopes::SNAPSHOTS, snapshot_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": snapshot_id }))
            }
        });
    }
}
