use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::{validate_image_allowed, validate_sandbox_config};
use crate::config::EngineConfig;
use crate::docker;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, SandboxConfig, SandboxTemplate};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    // sandbox::create
    {
        let kv = kv.clone();
        let dk = dk.clone();
        let cfg = config.clone();
        bridge.register_function_with_description("sandbox::create", "Create a new Docker sandbox container", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            let cfg = cfg.clone();
            async move {
                let mut merged = input.clone();
                if let Some(tpl_name) = input.get("template").and_then(|v| v.as_str()) {
                    let templates: Vec<SandboxTemplate> = kv.list(scopes::TEMPLATES).await;
                    let tpl = templates
                        .iter()
                        .find(|t| t.name == tpl_name || t.id == tpl_name)
                        .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Template not found: {tpl_name}")))?;
                    let tpl_val = serde_json::to_value(&tpl.config).unwrap_or(Value::Null);
                    if let (Some(base), Some(overrides)) = (tpl_val.as_object(), input.as_object()) {
                        let mut m = base.clone();
                        for (k, v) in overrides {
                            if k != "template" {
                                m.insert(k.clone(), v.clone());
                            }
                        }
                        merged = Value::Object(m);
                    }
                }

                let validated = validate_sandbox_config(&merged)
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                let sandbox_cfg: SandboxConfig = serde_json::from_value(validated.clone())
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                if !validate_image_allowed(&sandbox_cfg.image, &cfg.allowed_images) {
                    return Err(iii_sdk::IIIError::Handler(format!("Image not allowed: {}", sandbox_cfg.image)));
                }

                let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;
                if sandboxes.len() >= cfg.max_sandboxes {
                    return Err(iii_sdk::IIIError::Handler(format!("Maximum sandbox limit reached: {}", cfg.max_sandboxes)));
                }

                let id = generate_id("sbx");
                let now = now_ms();
                let timeout = sandbox_cfg.timeout.unwrap_or(cfg.default_timeout);

                let full_config = SandboxConfig {
                    image: sandbox_cfg.image.clone(),
                    name: sandbox_cfg.name.clone(),
                    timeout: Some(timeout),
                    memory: Some(sandbox_cfg.memory.unwrap_or(cfg.default_memory)),
                    cpu: Some(sandbox_cfg.cpu.unwrap_or(cfg.default_cpu as f64)),
                    workdir: Some(sandbox_cfg.workdir.clone().unwrap_or_else(|| cfg.workspace_dir.clone())),
                    network: sandbox_cfg.network,
                    env: sandbox_cfg.env.clone(),
                    metadata: sandbox_cfg.metadata.clone(),
                    entrypoint: sandbox_cfg.entrypoint.clone(),
                };

                docker::ensure_image(&dk, &sandbox_cfg.image).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                docker::create_container(&dk, &id, &full_config, sandbox_cfg.entrypoint.as_deref()).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;

                let sandbox = Sandbox {
                    id: id.clone(),
                    name: sandbox_cfg.name.clone().unwrap_or_else(|| id.clone()),
                    image: sandbox_cfg.image.clone(),
                    status: "running".to_string(),
                    created_at: now,
                    expires_at: now + timeout * 1000,
                    config: full_config,
                    metadata: sandbox_cfg.metadata.clone().unwrap_or_default(),
                    entrypoint: sandbox_cfg.entrypoint.clone(),
                };

                kv.set(scopes::SANDBOXES, &id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // sandbox::get
    {
        let kv = kv.clone();
        bridge.register_function_with_description("sandbox::get", "Get sandbox details by ID", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // sandbox::list
    {
        let kv = kv.clone();
        bridge.register_function_with_description("sandbox::list", "List sandboxes with filtering and pagination", move |input: Value| {
            let kv = kv.clone();
            async move {
                let mut sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;

                if let Some(status) = input.get("status").and_then(|v| v.as_str()) {
                    sandboxes.retain(|s| s.status == status);
                }
                if let Some(metadata) = input.get("metadata").and_then(|v| v.as_object()) {
                    sandboxes.retain(|s| {
                        metadata.iter().all(|(k, v)| {
                            s.metadata.get(k).map(|sv| sv.as_str()) == v.as_str().map(|s| s)
                        })
                    });
                }

                let total = sandboxes.len();
                let page = input.get("page").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let page_size = input.get("pageSize").and_then(|v| v.as_u64()).unwrap_or(20).clamp(1, 200) as usize;
                let start = (page - 1) * page_size;
                let items: Vec<&Sandbox> = sandboxes.iter().skip(start).take(page_size).collect();

                Ok(json!({
                    "items": items,
                    "total": total,
                    "page": page,
                    "pageSize": page_size,
                }))
            }
        });
    }

    // sandbox::renew
    {
        let kv = kv.clone();
        bridge.register_function_with_description("sandbox::renew", "Extend sandbox TTL", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let expires_at = input.get("expiresAt").and_then(|v| v.as_u64())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("expiresAt is required".into()))?;

                let mut sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let now = now_ms();
                sandbox.expires_at = expires_at.clamp(now + 60_000, now + 86_400_000);
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // sandbox::kill
    {
        let kv = kv.clone();
        let dk = dk.clone();
        bridge.register_function_with_description("sandbox::kill", "Stop and remove a sandbox container", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let container_name = format!("iii-sbx-{id}");
                let _ = dk.stop_container(&container_name, None).await;
                let _ = dk.remove_container(
                    &container_name,
                    Some(RemoveContainerOptions { force: true, ..Default::default() }),
                ).await;

                kv.delete(scopes::SANDBOXES, id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                Ok(json!({ "success": true }))
            }
        });
    }

    // sandbox::pause
    {
        let kv = kv.clone();
        let dk = dk.clone();
        bridge.register_function_with_description("sandbox::pause", "Pause a running sandbox", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let mut sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let container_name = format!("iii-sbx-{id}");
                dk.pause_container(&container_name).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to pause sandbox: {e}")))?;

                sandbox.status = "paused".to_string();
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // sandbox::resume
    {
        let kv = kv.clone();
        let dk = dk.clone();
        bridge.register_function_with_description("sandbox::resume", "Resume a paused sandbox", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let mut sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                if sandbox.status != "paused" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not paused: {}", sandbox.status)));
                }

                let container_name = format!("iii-sbx-{id}");
                dk.unpause_container(&container_name).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Failed to resume sandbox: {e}")))?;

                sandbox.status = "running".to_string();
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                serde_json::to_value(&sandbox).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }
}

use bollard::container::RemoveContainerOptions;
