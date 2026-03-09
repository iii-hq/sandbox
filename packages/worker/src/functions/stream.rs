use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::docker::{container_logs, get_container_stats};
use crate::state::{scopes, StateKV};
use crate::types::{Sandbox, SandboxEvent};

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // stream::logs (non-SSE fallback — returns collected log data)
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function_with_description("stream::logs", "Stream container logs via SSE", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("path_params")
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .or_else(|| input.get("id").and_then(|v| v.as_str()))
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let query = input.get("query_params").unwrap_or(&Value::Null);
                let tail = query.get("tail").and_then(|v| v.as_str()).unwrap_or("100");

                let cn = format!("iii-sbx-{id}");
                let logs = container_logs(&dk, &cn, false, tail).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                Ok(json!({ "logs": logs }))
            }
        });
    }

    // stream::metrics (returns one-shot metrics)
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function_with_description("stream::metrics", "Stream resource metrics via SSE", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("path_params")
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .or_else(|| input.get("id").and_then(|v| v.as_str()))
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let cn = format!("iii-sbx-{id}");
                let stats = get_container_stats(&dk, &cn, id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                serde_json::to_value(&stats).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // stream::events (returns recent events)
    {
        let kv = kv.clone();
        bridge.register_function_with_description("stream::events", "Stream events via SSE", move |input: Value| {
            let kv = kv.clone();
            async move {
                let query = input.get("query_params").unwrap_or(&Value::Null);
                let topic = query.get("topic").and_then(|v| v.as_str());

                let mut events: Vec<SandboxEvent> = kv.list(scopes::EVENTS).await;
                if let Some(t) = topic {
                    events.retain(|e| e.topic == t);
                }
                events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
                events.truncate(100);
                Ok(json!({ "events": events }))
            }
        });
    }
}
