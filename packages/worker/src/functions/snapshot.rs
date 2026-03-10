use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, Snapshot};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, config: &EngineConfig) {
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("snapshot::create", "Create a snapshot of sandbox state", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
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
                let repo = format!("iii-sbx-snap-{snapshot_id}");
                let comment = name.unwrap_or(&snapshot_id).to_string();
                let image_id = rt.commit_sandbox(&cn, &repo, &comment).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Commit failed: {e}")))?;

                let size = rt.inspect_image_size(&image_id).await.unwrap_or(0);

                let snapshot = Snapshot {
                    id: snapshot_id.clone(),
                    sandbox_id: id.to_string(),
                    name: name.unwrap_or(&snapshot_id).to_string(),
                    image_id: image_id.clone(),
                    size,
                    created_at: now_ms(),
                    config: Some(sandbox.config.clone()),
                    entrypoint: sandbox.entrypoint.clone(),
                    metadata: Some(sandbox.metadata.clone()),
                };
                kv.set(scopes::SNAPSHOTS, &snapshot_id, &snapshot).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&snapshot).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("snapshot::restore", "Restore sandbox from snapshot", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
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
                let _ = rt.stop_sandbox(&cn).await;
                let _ = rt.remove_sandbox(&cn, true).await;

                let mut restored_config = sandbox.config.clone();
                restored_config.image = snapshot.image_id.clone();
                rt.create_sandbox(id, &restored_config, sandbox.entrypoint.as_deref()).await
                    .map_err(iii_sdk::IIIError::Handler)?;

                sandbox.status = "running".to_string();
                sandbox.image = snapshot.image_id.clone();
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

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

    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("snapshot::delete", "Delete a snapshot", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let snapshot_id = input.get("snapshotId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("snapshotId is required".into()))?;
                let snapshot: Snapshot = kv.get(scopes::SNAPSHOTS, snapshot_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Snapshot not found: {snapshot_id}")))?;
                let _ = rt.remove_image(&snapshot.image_id).await;
                kv.delete(scopes::SNAPSHOTS, snapshot_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": snapshot_id }))
            }
        });
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description("snapshot::get-owner", "Get snapshot owner sandbox info for routing", move |input: Value| {
            let kv = kv.clone();
            async move {
                let snapshot_id = input.get("snapshotId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("snapshotId is required".into()))?;
                let snapshot: Snapshot = kv.get(scopes::SNAPSHOTS, snapshot_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Snapshot not found: {snapshot_id}")))?;
                Ok(json!({ "sandboxId": snapshot.sandbox_id }))
            }
        });
    }

    {
        let kv = kv.clone(); let rt = rt.clone(); let cfg = config.clone();
        iii.register_function_with_description("snapshot::clone", "Create a new sandbox from an existing snapshot", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone(); let cfg = cfg.clone();
            async move {
                let snapshot_id = input.get("snapshotId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("snapshotId is required".into()))?;
                let name = input.get("name").and_then(|v| v.as_str());

                let snapshot: Snapshot = kv.get(scopes::SNAPSHOTS, snapshot_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Snapshot not found: {snapshot_id}")))?;

                let base_config = if let Some(ref cfg_stored) = snapshot.config {
                    cfg_stored.clone()
                } else {
                    let source: Sandbox = kv.get(scopes::SANDBOXES, &snapshot.sandbox_id).await
                        .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Source sandbox not found: {}", snapshot.sandbox_id)))?;
                    source.config.clone()
                };
                let base_entrypoint = snapshot.entrypoint.clone();
                let base_metadata = snapshot.metadata.clone().unwrap_or_default();

                let new_id = generate_id("sbx");
                let mut cloned_config = base_config;
                cloned_config.image = snapshot.image_id.clone();
                rt.create_sandbox(&new_id, &cloned_config, base_entrypoint.as_deref()).await
                    .map_err(iii_sdk::IIIError::Handler)?;

                let now = now_ms();
                let timeout = cloned_config.timeout.unwrap_or(cfg.default_timeout);
                let sandbox = Sandbox {
                    id: new_id.clone(),
                    name: name.unwrap_or(&new_id).to_string(),
                    image: snapshot.image_id.clone(),
                    status: "running".to_string(),
                    created_at: now,
                    expires_at: now + timeout * 1000,
                    config: cloned_config,
                    metadata: base_metadata,
                    entrypoint: base_entrypoint,
                    worker_id: Some(cfg.worker_name.clone()),
                };

                kv.set(scopes::SANDBOXES, &new_id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }
}
