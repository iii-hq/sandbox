use bollard::network::{ConnectNetworkOptions, CreateNetworkOptions, DisconnectNetworkOptions};
use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, SandboxNetwork};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // network::create
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("network::create", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
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
                let opts = CreateNetworkOptions {
                    name: docker_name.as_str(),
                    driver,
                    ..Default::default()
                };
                let result = dk.create_network(opts).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Create network failed: {e}")))?;

                let docker_network_id = result.id;

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

    // network::list
    {
        let kv = kv.clone();
        bridge.register_function("network::list", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let networks: Vec<SandboxNetwork> = kv.list(scopes::NETWORKS).await;
                Ok(json!({ "networks": networks }))
            }
        });
    }

    // network::connect
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("network::connect", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
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
                dk.connect_network(&network.docker_network_id, ConnectNetworkOptions {
                    container: cn.as_str(),
                    ..Default::default()
                }).await.map_err(|e| iii_sdk::IIIError::Handler(format!("Connect failed: {e}")))?;

                network.sandboxes.push(sandbox_id.to_string());
                kv.set(scopes::NETWORKS, network_id, &network).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "connected": true }))
            }
        });
    }

    // network::disconnect
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("network::disconnect", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
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
                dk.disconnect_network(&network.docker_network_id, DisconnectNetworkOptions {
                    container: cn.as_str(),
                    ..Default::default()
                }).await.map_err(|e| iii_sdk::IIIError::Handler(format!("Disconnect failed: {e}")))?;

                network.sandboxes.retain(|s| s != sandbox_id);
                kv.set(scopes::NETWORKS, network_id, &network).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "disconnected": true }))
            }
        });
    }

    // network::delete
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("network::delete", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let network_id = input.get("networkId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("networkId is required".into()))?;
                let network: SandboxNetwork = kv.get(scopes::NETWORKS, network_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Network not found: {network_id}")))?;

                for sandbox_id in &network.sandboxes {
                    let cn = format!("iii-sbx-{sandbox_id}");
                    let _ = dk.disconnect_network(&network.docker_network_id, DisconnectNetworkOptions {
                        container: cn.as_str(),
                        ..Default::default()
                    }).await;
                }

                dk.remove_network(&network.docker_network_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Remove network failed: {e}")))?;
                kv.delete(scopes::NETWORKS, network_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": network_id }))
            }
        });
    }
}
