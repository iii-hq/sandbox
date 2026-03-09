use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::SandboxEvent;

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(bridge: &Arc<III>, kv: &StateKV, _config: &EngineConfig) {
    // event::publish
    {
        let kv = kv.clone();
        let bridge2 = bridge.clone();
        bridge.register_function_with_description("event::publish", "Publish an event to subscribers", move |input: Value| {
            let kv = kv.clone();
            let bridge2 = bridge2.clone();
            async move {
                let topic = input.get("topic").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("topic is required".into()))?;
                let sandbox_id = input.get("sandboxId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;
                let data = input.get("data").cloned().unwrap_or(json!({}));

                let id = generate_id("evt");
                let event = SandboxEvent {
                    id: id.clone(),
                    topic: topic.to_string(),
                    sandbox_id: sandbox_id.to_string(),
                    data: data.clone(),
                    timestamp: now_ms(),
                };
                kv.set(scopes::EVENTS, &id, &event).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                let _ = bridge2.trigger_void("queue::publish", json!({
                    "topic": topic,
                    "payload": &event,
                }));

                serde_json::to_value(&event).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // event::history
    {
        let kv = kv.clone();
        bridge.register_function_with_description("event::history", "Get event history", move |input: Value| {
            let kv = kv.clone();
            async move {
                let mut events: Vec<SandboxEvent> = kv.list(scopes::EVENTS).await;

                if let Some(sandbox_id) = input.get("sandboxId").and_then(|v| v.as_str()) {
                    events.retain(|e| e.sandbox_id == sandbox_id);
                }
                if let Some(topic) = input.get("topic").and_then(|v| v.as_str()) {
                    events.retain(|e| e.topic == topic);
                }

                events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
                let total = events.len();
                let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let limit = input.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let sliced: Vec<&SandboxEvent> = events.iter().skip(offset).take(limit).collect();
                Ok(json!({ "events": sliced, "total": total }))
            }
        });
    }

    // event::subscribe
    {
        let kv = kv.clone();
        let bridge2 = bridge.clone();
        bridge.register_function_with_description("event::subscribe", "Subscribe to event topic", move |input: Value| {
            let kv = kv.clone();
            let bridge2 = bridge2.clone();
            async move {
                let topic = input.get("topic").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("topic is required".into()))?;
                let handler_id = format!("event::on-{}", topic.replace('.', "-"));

                let kv2 = kv.clone();
                let topic_str = topic.to_string();
                bridge2.register_function(&handler_id, move |data: Value| {
                    let kv2 = kv2.clone();
                    let topic_str = topic_str.clone();
                    async move {
                        let id = generate_id("evt");
                        let event = SandboxEvent {
                            id: id.clone(),
                            topic: topic_str,
                            sandbox_id: data.get("sandboxId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            data,
                            timestamp: now_ms(),
                        };
                        kv2.set(scopes::EVENTS, &id, &event).await
                            .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                        Ok(Value::Null)
                    }
                });

                bridge2.register_trigger("queue", &handler_id, json!({ "topic": topic }))
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                Ok(json!({ "subscribed": topic }))
            }
        });
    }
}
