use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{scopes, StateKV};
use crate::types::{PortMapping, Sandbox};

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    // port::expose
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("port::expose", "Expose a port on sandbox container", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let container_port = input.get("containerPort").and_then(|v| v.as_u64())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("containerPort is required".into()))? as u16;
                let protocol = input.get("protocol").and_then(|v| v.as_str()).unwrap_or("tcp");

                if container_port < 1 {
                    return Err(iii_sdk::IIIError::Handler(format!("Invalid container port: {container_port}")));
                }
                if protocol != "tcp" && protocol != "udp" {
                    return Err(iii_sdk::IIIError::Handler(format!("Invalid protocol: {protocol}")));
                }

                let mut sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let mut existing: Vec<PortMapping> = sandbox.metadata.get("ports")
                    .and_then(|v| serde_json::from_str(v).ok())
                    .unwrap_or_default();

                if existing.iter().any(|p| p.container_port == container_port && p.protocol == protocol) {
                    return Err(iii_sdk::IIIError::Handler(format!("Port {container_port}/{protocol} already exposed")));
                }

                let mut host_port = input.get("hostPort").and_then(|v| v.as_u64()).unwrap_or(container_port as u64) as u16;
                let mut state = "mapped".to_string();

                let cn = format!("iii-sbx-{id}");
                if let Ok(bindings) = rt.sandbox_port_bindings(&cn).await {
                    let key = format!("{container_port}/{protocol}");
                    if let Some(Some(hp)) = bindings.get(&key) {
                        host_port = *hp;
                        state = "active".to_string();
                    }
                }

                let mapping = PortMapping {
                    container_port,
                    host_port,
                    protocol: protocol.to_string(),
                    state,
                };
                existing.push(mapping.clone());
                sandbox.metadata.insert("ports".to_string(), serde_json::to_string(&existing).unwrap());
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                serde_json::to_value(&mapping).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // port::list
    {
        let kv = kv.clone(); let rt = rt.clone();
        iii.register_function_with_description("port::list", "List exposed ports", move |input: Value| {
            let kv = kv.clone(); let rt = rt.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let mut stored: Vec<PortMapping> = sandbox.metadata.get("ports")
                    .and_then(|v| serde_json::from_str(v).ok())
                    .unwrap_or_default();

                let cn = format!("iii-sbx-{id}");
                if let Ok(bindings) = rt.sandbox_port_bindings(&cn).await {
                    for mapping in &mut stored {
                        let key = format!("{}/{}", mapping.container_port, mapping.protocol);
                        if let Some(Some(hp)) = bindings.get(&key) {
                            mapping.host_port = *hp;
                            mapping.state = "active".to_string();
                        } else {
                            mapping.state = "mapped".to_string();
                        }
                    }
                }
                Ok(json!({ "ports": stored }))
            }
        });
    }

    // port::unexpose
    {
        let kv = kv.clone();
        iii.register_function_with_description("port::unexpose", "Unexpose a port", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let container_port = input.get("containerPort").and_then(|v| v.as_u64())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("containerPort is required".into()))? as u16;

                let mut sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let mut existing: Vec<PortMapping> = sandbox.metadata.get("ports")
                    .and_then(|v| serde_json::from_str(v).ok())
                    .unwrap_or_default();
                let before = existing.len();
                existing.retain(|p| p.container_port != container_port);
                if existing.len() == before {
                    return Err(iii_sdk::IIIError::Handler(format!("Port {container_port} is not exposed")));
                }
                sandbox.metadata.insert("ports".to_string(), serde_json::to_string(&existing).unwrap());
                kv.set(scopes::SANDBOXES, id, &sandbox).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "removed": container_port }))
            }
        });
    }
}
