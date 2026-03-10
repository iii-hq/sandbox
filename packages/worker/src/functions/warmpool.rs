use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::docker;
use crate::state::{scopes, StateKV};
use crate::types::SandboxConfig;

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    // warmpool::acquire — try to pop a pre-warmed container matching the profile
    {
        let kv = kv.clone();
        let dk = dk.clone();
        iii.register_function_with_description("warmpool::acquire", "Acquire a pre-warmed container from the pool", move |input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            async move {
                let profile_key = build_profile_key(&input);

                let pool: Vec<PoolEntry> = kv.list(scopes::POOL).await;
                let candidate = pool.iter().find(|e| e.profile_key == profile_key && e.status == "ready");

                match candidate {
                    Some(entry) => {
                        let container_id = entry.container_name.clone();
                        let entry_id = entry.id.clone();

                        kv.delete(scopes::POOL, &entry_id).await
                            .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                        let inspect = dk.inspect_container(&container_id, None).await;
                        if inspect.is_err() {
                            return Err(iii_sdk::IIIError::Handler("Pool container no longer exists".into()));
                        }

                        Ok(json!({ "container_name": container_id }))
                    }
                    None => Err(iii_sdk::IIIError::Handler("No matching container in pool".into())),
                }
            }
        });
    }

    // warmpool::replenish — fill pool back to target size per profile
    {
        let kv = kv.clone();
        let dk = dk.clone();
        let cfg = config.clone();
        iii.register_function_with_description("warmpool::replenish", "Replenish warm container pool to target sizes", move |_input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            let cfg = cfg.clone();
            async move {
                let pool_size = cfg.warm_pool_size;
                if pool_size == 0 {
                    return Ok(json!({ "skipped": true, "reason": "pool_size is 0" }));
                }

                let profiles = default_profiles(&cfg);
                let existing: Vec<PoolEntry> = kv.list(scopes::POOL).await;
                let mut created = 0u32;

                for profile in &profiles {
                    let key = profile_key_from_config(profile);
                    let count = existing.iter().filter(|e| e.profile_key == key && e.status == "ready").count();
                    let needed = pool_size.saturating_sub(count);

                    for _ in 0..needed {
                        let pool_id = crate::state::generate_id("pool");
                        let container_name = format!("iii-pool-{pool_id}");

                        let create_result = docker::create_pool_container(&dk, &container_name, profile).await;
                        match create_result {
                            Ok(()) => {
                                let entry = PoolEntry {
                                    id: pool_id.clone(),
                                    container_name: container_name.clone(),
                                    profile_key: key.clone(),
                                    status: "ready".to_string(),
                                };
                                let _ = kv.set(scopes::POOL, &pool_id, &entry).await;
                                created += 1;
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, profile = %key, "Failed to create pool container");
                            }
                        }
                    }
                }

                Ok(json!({ "created": created }))
            }
        });
    }

    // warmpool::status — report pool status
    {
        let kv = kv.clone();
        iii.register_function_with_description("warmpool::status", "Get warm pool status", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let pool: Vec<PoolEntry> = kv.list(scopes::POOL).await;
                let ready = pool.iter().filter(|e| e.status == "ready").count();

                let mut by_profile: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
                for entry in &pool {
                    if entry.status == "ready" {
                        *by_profile.entry(entry.profile_key.clone()).or_default() += 1;
                    }
                }

                Ok(json!({
                    "total": pool.len(),
                    "ready": ready,
                    "by_profile": by_profile,
                }))
            }
        });
    }

    // warmpool::drain — remove all pool containers (used during shutdown)
    {
        let kv = kv.clone();
        let dk = dk.clone();
        iii.register_function_with_description("warmpool::drain", "Drain and remove all warm pool containers", move |_input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            async move {
                let pool: Vec<PoolEntry> = kv.list(scopes::POOL).await;
                let mut removed = 0u32;

                for entry in &pool {
                    let _ = dk.stop_container(&entry.container_name, None).await;
                    let _ = dk.remove_container(
                        &entry.container_name,
                        Some(bollard::container::RemoveContainerOptions { force: true, ..Default::default() }),
                    ).await;
                    let _ = kv.delete(scopes::POOL, &entry.id).await;
                    removed += 1;
                }

                Ok(json!({ "removed": removed }))
            }
        });
    }

    // Register replenish cron if pool is enabled
    if config.warm_pool_size > 0 {
        let _ = iii.register_trigger("cron", "warmpool::replenish", json!({
            "expression": config.warm_pool_replenish_interval,
        }));
    }

    // Register API endpoint for pool status
    let _ = iii.register_trigger("http", "warmpool::status", json!({
        "api_path": format!("{}/pool/status", config.api_prefix),
        "http_method": "GET",
        "auth": true,
    }));
}

fn build_profile_key(input: &Value) -> String {
    let image = input.get("image").and_then(|v| v.as_str()).unwrap_or("python:3.12-slim");
    let memory = input.get("memory").and_then(|v| v.as_u64()).unwrap_or(512);
    let cpu = input.get("cpu").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let network = input.get("network").and_then(|v| v.as_bool()).unwrap_or(true);
    format!("{image}:{memory}:{cpu}:{network}")
}

fn profile_key_from_config(config: &SandboxConfig) -> String {
    let memory = config.memory.unwrap_or(512);
    let cpu = config.cpu.unwrap_or(1.0);
    let network = config.network.unwrap_or(true);
    format!("{}:{memory}:{cpu}:{network}", config.image)
}

fn default_profiles(config: &EngineConfig) -> Vec<SandboxConfig> {
    config.warm_pool_profiles.iter().map(|p| SandboxConfig {
        image: p.image.clone(),
        name: None,
        timeout: None,
        memory: Some(p.memory_mb),
        cpu: Some(p.cpu),
        workdir: None,
        network: Some(p.network_enabled),
        env: None,
        metadata: None,
        entrypoint: None,
    }).collect()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PoolEntry {
    id: String,
    container_name: String,
    profile_key: String,
    status: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_key_defaults() {
        let input = json!({});
        assert_eq!(build_profile_key(&input), "python:3.12-slim:512:1:true");
    }

    #[test]
    fn profile_key_custom() {
        let input = json!({ "image": "node:20", "memory": 1024, "cpu": 2.0, "network": false });
        assert_eq!(build_profile_key(&input), "node:20:1024:2:false");
    }

    #[test]
    fn profile_key_from_sandbox_config() {
        let cfg = SandboxConfig {
            image: "ubuntu:22.04".to_string(),
            name: None,
            timeout: None,
            memory: Some(512),
            cpu: Some(1.0),
            workdir: None,
            network: Some(true),
            env: None,
            metadata: None,
            entrypoint: None,
        };
        assert_eq!(profile_key_from_config(&cfg), "ubuntu:22.04:512:1:true");
    }

    #[test]
    fn profile_key_from_config_defaults() {
        let cfg = SandboxConfig {
            image: "alpine:latest".to_string(),
            name: None,
            timeout: None,
            memory: None,
            cpu: None,
            workdir: None,
            network: None,
            env: None,
            metadata: None,
            entrypoint: None,
        };
        assert_eq!(profile_key_from_config(&cfg), "alpine:latest:512:1:true");
    }
}
