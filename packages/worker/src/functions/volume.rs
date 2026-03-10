use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, SandboxVolume};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("volume::create", "Create a persistent volume", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let name = input.get("name").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("name is required".into()))?;
                let _driver = input.get("driver").and_then(|v| v.as_str()).unwrap_or("local");
                let volume_id = generate_id("vol");
                let docker_volume_name = format!("iii-vol-{volume_id}");

                let labels = HashMap::new();
                rt.create_volume(&docker_volume_name, labels).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Create volume failed: {e}")))?;

                let volume = SandboxVolume {
                    id: volume_id.clone(), name: name.to_string(),
                    docker_volume_name, mount_path: None,
                    sandbox_id: None, size: None, created_at: now_ms(),
                };
                kv.set(scopes::VOLUMES, &volume_id, &volume).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&volume).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description("volume::list", "List persistent volumes", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let volumes: Vec<SandboxVolume> = kv.list(scopes::VOLUMES).await;
                Ok(json!({ "volumes": volumes }))
            }
        });
    }

    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("volume::delete", "Delete a persistent volume", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let volume_id = input.get("volumeId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("volumeId is required".into()))?;
                let volume: SandboxVolume = kv.get(scopes::VOLUMES, volume_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Volume not found: {volume_id}")))?;
                let _ = rt.remove_volume(&volume.docker_volume_name).await;
                kv.delete(scopes::VOLUMES, volume_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": volume_id }))
            }
        });
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description("volume::attach", "Attach volume to sandbox", move |input: Value| {
            let kv = kv.clone();
            async move {
                let volume_id = input.get("volumeId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("volumeId is required".into()))?;
                let sandbox_id = input.get("sandboxId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;
                let mount_path = input.get("mountPath").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("mountPath is required".into()))?;

                let mut volume: SandboxVolume = kv.get(scopes::VOLUMES, volume_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Volume not found: {volume_id}")))?;
                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, sandbox_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {sandbox_id}")))?;

                volume.sandbox_id = Some(sandbox_id.to_string());
                volume.mount_path = Some(mount_path.to_string());
                kv.set(scopes::VOLUMES, volume_id, &volume).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "attached": true, "mountPath": mount_path }))
            }
        });
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description("volume::detach", "Detach volume from sandbox", move |input: Value| {
            let kv = kv.clone();
            async move {
                let volume_id = input.get("volumeId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("volumeId is required".into()))?;
                let mut volume: SandboxVolume = kv.get(scopes::VOLUMES, volume_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Volume not found: {volume_id}")))?;
                volume.sandbox_id = None;
                volume.mount_path = None;
                kv.set(scopes::VOLUMES, volume_id, &volume).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "detached": true }))
            }
        });
    }
}
