use bollard::volume::CreateVolumeOptions;
use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, SandboxVolume};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // volume::create
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("volume::create", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let name = input.get("name").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("name is required".into()))?;
                let driver = input.get("driver").and_then(|v| v.as_str()).unwrap_or("local");
                let volume_id = generate_id("vol");
                let docker_volume_name = format!("iii-vol-{volume_id}");

                let opts = CreateVolumeOptions {
                    name: docker_volume_name.as_str(),
                    driver,
                    driver_opts: HashMap::new(),
                    labels: HashMap::new(),
                };
                dk.create_volume(opts).await
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

    // volume::list
    {
        let kv = kv.clone();
        bridge.register_function("volume::list", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let volumes: Vec<SandboxVolume> = kv.list(scopes::VOLUMES).await;
                Ok(json!({ "volumes": volumes }))
            }
        });
    }

    // volume::delete
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("volume::delete", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let volume_id = input.get("volumeId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("volumeId is required".into()))?;
                let volume: SandboxVolume = kv.get(scopes::VOLUMES, volume_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Volume not found: {volume_id}")))?;
                let _ = dk.remove_volume(&volume.docker_volume_name, None).await;
                kv.delete(scopes::VOLUMES, volume_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": volume_id }))
            }
        });
    }

    // volume::attach
    {
        let kv = kv.clone();
        bridge.register_function("volume::attach", move |input: Value| {
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

    // volume::detach
    {
        let kv = kv.clone();
        bridge.register_function("volume::detach", move |input: Value| {
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
