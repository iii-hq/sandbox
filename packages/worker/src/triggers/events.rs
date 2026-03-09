use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::{generate_id, scopes, StateKV};
use crate::types::SandboxEvent;

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(bridge: &Arc<III>, kv: &StateKV) {
    let events = vec![
        ("event::sandbox-created", "sandbox.created"),
        ("event::sandbox-killed", "sandbox.killed"),
        ("event::sandbox-expired", "sandbox.expired"),
        ("event::sandbox-paused", "sandbox.paused"),
        ("event::sandbox-resumed", "sandbox.resumed"),
        ("event::sandbox-snapshot", "sandbox.snapshot"),
        ("event::sandbox-exec", "sandbox.exec"),
        ("event::sandbox-error", "sandbox.error"),
    ];

    for (id, topic) in events {
        let kv = kv.clone();
        let topic_str = topic.to_string();
        bridge.register_function(id, move |data: Value| {
            let kv = kv.clone();
            let topic_str = topic_str.clone();
            async move {
                let event_id = generate_id("evt");
                let sandbox_id = data.get("sandboxId")
                    .or_else(|| data.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let event = SandboxEvent {
                    id: event_id.clone(),
                    topic: topic_str,
                    sandbox_id,
                    data,
                    timestamp: now_ms(),
                };
                let _ = kv.set(scopes::EVENTS, &event_id, &event).await;
                Ok(Value::Null)
            }
        });

        let _ = bridge.register_trigger("queue", id, json!({ "topic": topic }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENTS: &[(&str, &str)] = &[
        ("event::sandbox-created", "sandbox.created"),
        ("event::sandbox-killed", "sandbox.killed"),
        ("event::sandbox-expired", "sandbox.expired"),
        ("event::sandbox-paused", "sandbox.paused"),
        ("event::sandbox-resumed", "sandbox.resumed"),
        ("event::sandbox-snapshot", "sandbox.snapshot"),
        ("event::sandbox-exec", "sandbox.exec"),
        ("event::sandbox-error", "sandbox.error"),
    ];

    #[test]
    fn event_topics_count() {
        assert_eq!(EVENTS.len(), 8);
    }

    #[test]
    fn each_topic_follows_sandbox_dot_pattern() {
        for (_, topic) in EVENTS {
            assert!(
                topic.starts_with("sandbox."),
                "Topic does not follow sandbox.xxx pattern: {topic}"
            );
        }
    }

    #[test]
    fn each_event_id_follows_event_sandbox_pattern() {
        for (id, _) in EVENTS {
            assert!(
                id.starts_with("event::sandbox-"),
                "Event ID does not follow event::sandbox-xxx pattern: {id}"
            );
        }
    }

    #[test]
    fn now_ms_returns_reasonable_timestamp() {
        let ts = now_ms();
        assert!(ts > 1_700_000_000_000, "Timestamp {ts} is too old (before Nov 2023)");
    }

    #[test]
    fn now_ms_increases_or_equal() {
        let t1 = now_ms();
        let t2 = now_ms();
        assert!(t2 >= t1, "Second call {t2} was less than first {t1}");
    }

    #[test]
    fn created_event_exists() {
        assert!(EVENTS.iter().any(|(id, _)| *id == "event::sandbox-created"));
    }

    #[test]
    fn killed_event_exists() {
        assert!(EVENTS.iter().any(|(id, _)| *id == "event::sandbox-killed"));
    }

    #[test]
    fn error_event_exists() {
        assert!(EVENTS.iter().any(|(id, _)| *id == "event::sandbox-error"));
    }

    #[test]
    fn topic_and_id_correspond() {
        for (id, topic) in EVENTS {
            let id_suffix = id.strip_prefix("event::sandbox-").unwrap();
            let topic_suffix = topic.strip_prefix("sandbox.").unwrap();
            assert_eq!(
                id_suffix, topic_suffix,
                "Mismatch: id suffix '{id_suffix}' != topic suffix '{topic_suffix}'"
            );
        }
    }

    #[test]
    fn no_duplicate_event_ids() {
        let mut seen = std::collections::HashSet::new();
        for (id, _) in EVENTS {
            assert!(seen.insert(*id), "Duplicate event ID: {id}");
        }
    }
}
