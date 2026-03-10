use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, SandboxNetwork};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("network::create", "Create a Docker network", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let name = input.get("name").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("Network requires name".into()))?;
                let driver = input.get("driver").and_then(|v| v.as_str()).unwrap_or("bridge");

                let existing: Vec<SandboxNetwork> = kv.list(scopes::NETWORKS).await;
                if existing.iter().any(|n| n.name == name) {
                    return Err(iii_sdk::IIIError::Handler(format!("Network {name} already exists")));
                }

                let network_id = generate_id("net");
                let docker_name = format!("iii-net-{network_id}");
                let labels = HashMap::new();
                let docker_network_id = rt.create_network(&docker_name, driver, labels).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Create network failed: {e}")))?;

                let network = SandboxNetwork {
                    id: network_id.clone(), name: name.to_string(),
                    docker_network_id, sandboxes: vec![],
                    created_at: now_ms(),
                };
                kv.set(scopes::NETWORKS, &network_id, &network).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&network).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description("network::list", "List Docker networks", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let networks: Vec<SandboxNetwork> = kv.list(scopes::NETWORKS).await;
                Ok(json!({ "networks": networks }))
            }
        });
    }

    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("network::connect", "Connect sandbox to network", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let network_id = input.get("networkId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("networkId is required".into()))?;
                let sandbox_id = input.get("sandboxId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;

                let mut network: SandboxNetwork = kv.get(scopes::NETWORKS, network_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Network not found: {network_id}")))?;
                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, sandbox_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {sandbox_id}")))?;

                if network.sandboxes.contains(&sandbox_id.to_string()) {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox {sandbox_id} already connected to network {network_id}")));
                }

                let cn = format!("iii-sbx-{sandbox_id}");
                rt.connect_network(&network.docker_network_id, &cn).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Connect failed: {e}")))?;

                network.sandboxes.push(sandbox_id.to_string());
                kv.set(scopes::NETWORKS, network_id, &network).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "connected": true }))
            }
        });
    }

    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("network::disconnect", "Disconnect sandbox from network", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let network_id = input.get("networkId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("networkId is required".into()))?;
                let sandbox_id = input.get("sandboxId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;

                let mut network: SandboxNetwork = kv.get(scopes::NETWORKS, network_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Network not found: {network_id}")))?;
                if !network.sandboxes.contains(&sandbox_id.to_string()) {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox {sandbox_id} is not connected to network {network_id}")));
                }

                let cn = format!("iii-sbx-{sandbox_id}");
                rt.disconnect_network(&network.docker_network_id, &cn, true).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Disconnect failed: {e}")))?;

                network.sandboxes.retain(|s| s != sandbox_id);
                kv.set(scopes::NETWORKS, network_id, &network).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "disconnected": true }))
            }
        });
    }

    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("network::delete", "Delete a Docker network", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let network_id = input.get("networkId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("networkId is required".into()))?;
                let network: SandboxNetwork = kv.get(scopes::NETWORKS, network_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Network not found: {network_id}")))?;

                for sandbox_id in &network.sandboxes {
                    let cn = format!("iii-sbx-{sandbox_id}");
                    let _ = rt.disconnect_network(&network.docker_network_id, &cn, true).await;
                }

                rt.remove_network(&network.docker_network_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Remove network failed: {e}")))?;
                kv.delete(scopes::NETWORKS, network_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": network_id }))
            }
        });
    }
}
