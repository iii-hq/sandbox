use iii_sdk::III;
use serde_json::Value;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::Sandbox;

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, config: &EngineConfig) {
    let kv = kv.clone(); let rt = rt.clone(); let cfg = config.clone();
    iii.register_function_with_description("sandbox::clone", "Clone a sandbox with its state", move |input: Value| {
        let kv = kv.clone(); let rt = rt.clone(); let cfg = cfg.clone();
        async move {
            let id = input.get("id").and_then(|v| v.as_str())
                .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
            let name = input.get("name").and_then(|v| v.as_str());

            let source: Sandbox = kv.get(scopes::SANDBOXES, id).await
                .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
            if source.status == "stopped" {
                return Err(iii_sdk::IIIError::Handler(format!("Sandbox is stopped: {id}")));
            }

            let new_id = generate_id("sbx");
            let cn = format!("iii-sbx-{id}");
            let repo = format!("iii-sbx-clone-{new_id}");
            let image_id = rt.commit_sandbox(&cn, &repo, "").await
                .map_err(|e| iii_sdk::IIIError::Handler(format!("Commit failed: {e}")))?;

            let mut cloned_config = source.config.clone();
            cloned_config.image = image_id.clone();
            rt.create_sandbox(&new_id, &cloned_config, source.entrypoint.as_deref()).await
                .map_err(iii_sdk::IIIError::Handler)?;

            let now = now_ms();
            let timeout = source.config.timeout.unwrap_or(cfg.default_timeout);
            let clone = Sandbox {
                id: new_id.clone(),
                name: name.unwrap_or(&new_id).to_string(),
                image: image_id,
                status: "running".to_string(),
                created_at: now,
                expires_at: now + timeout * 1000,
                config: cloned_config,
                metadata: source.metadata.clone(),
                entrypoint: source.entrypoint.clone(),
                worker_id: Some(cfg.worker_name.clone()),
            };

            kv.set(scopes::SANDBOXES, &new_id, &clone).await
                .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
            serde_json::to_value(&clone).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
        }
    });
}
