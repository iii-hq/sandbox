#![allow(dead_code)]
use iii_sdk::III;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub mod scopes {
    pub const SANDBOXES: &str = "sandbox";
    pub const METRICS: &str = "metrics";
    pub const GLOBAL: &str = "global";
    pub const BACKGROUND: &str = "background";
    pub const TEMPLATES: &str = "template";
    pub const SNAPSHOTS: &str = "snapshot";
    pub const EVENTS: &str = "event";
    pub const QUEUE: &str = "queue";
    pub const OBSERVABILITY: &str = "observability";
    pub const NETWORKS: &str = "network";
    pub const VOLUMES: &str = "volume";
    pub const ALERTS: &str = "alert";
    pub const ALERT_EVENTS: &str = "alert_event";
}

pub fn generate_id(prefix: &str) -> String {
    let hex = uuid::Uuid::new_v4()
        .as_bytes()
        .iter()
        .take(12)
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    format!("{prefix}_{hex}")
}

#[derive(Clone)]
pub struct StateKV {
    iii: Arc<III>,
}

impl StateKV {
    pub fn new(iii: Arc<III>) -> Self {
        Self { iii }
    }

    pub async fn get<T: DeserializeOwned>(&self, scope: &str, key: &str) -> Option<T> {
        let result = self
            .iii
            .trigger("state::get", json!({ "scope": scope, "key": key }))
            .await
            .ok()?;
        if result.is_null() {
            return None;
        }
        serde_json::from_value(result).ok()
    }

    pub async fn set<T: Serialize>(
        &self,
        scope: &str,
        key: &str,
        data: &T,
    ) -> Result<(), iii_sdk::IIIError> {
        self.iii
            .trigger(
                "state::set",
                json!({ "scope": scope, "key": key, "value": serde_json::to_value(data).unwrap_or(Value::Null) }),
            )
            .await?;
        Ok(())
    }

    pub async fn delete(
        &self,
        scope: &str,
        key: &str,
    ) -> Result<(), iii_sdk::IIIError> {
        self.iii
            .trigger("state::delete", json!({ "scope": scope, "key": key }))
            .await?;
        Ok(())
    }

    pub async fn list<T: DeserializeOwned>(&self, scope: &str) -> Vec<T> {
        let result = self
            .iii
            .trigger("state::list", json!({ "scope": scope }))
            .await
            .unwrap_or(Value::Array(vec![]));
        serde_json::from_value(result).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generate_id_starts_with_prefix_sbx() {
        let id = generate_id("sbx");
        assert!(id.starts_with("sbx_"), "expected prefix sbx_, got {id}");
    }

    #[test]
    fn generate_id_length_sbx() {
        let id = generate_id("sbx");
        assert_eq!(id.len(), 28, "expected len 28 (3+1+24), got {}", id.len());
    }

    #[test]
    fn generate_id_starts_with_prefix_evt() {
        let id = generate_id("evt");
        assert!(id.starts_with("evt_"), "expected prefix evt_, got {id}");
    }

    #[test]
    fn generate_id_length_evt() {
        let id = generate_id("evt");
        assert_eq!(id.len(), 28);
    }

    #[test]
    fn generate_id_uniqueness() {
        let ids: HashSet<String> = (0..100).map(|_| generate_id("sbx")).collect();
        assert_eq!(ids.len(), 100, "expected 100 unique IDs");
    }

    #[test]
    fn generate_id_hex_chars_only_after_prefix() {
        let id = generate_id("sbx");
        let hex_part = &id[4..];
        assert!(
            hex_part.chars().all(|c| c.is_ascii_hexdigit()),
            "non-hex char in {hex_part}"
        );
    }

    #[test]
    fn generate_id_single_char_prefix() {
        let id = generate_id("x");
        assert!(id.starts_with("x_"));
        assert_eq!(id.len(), 26);
    }

    #[test]
    fn generate_id_empty_prefix() {
        let id = generate_id("");
        assert!(id.starts_with("_"));
        assert_eq!(id.len(), 25);
    }

    #[test]
    fn generate_id_long_prefix() {
        let id = generate_id("sandbox");
        assert!(id.starts_with("sandbox_"));
        let hex_part = &id[8..];
        assert_eq!(hex_part.len(), 24);
    }

    #[test]
    fn scope_sandboxes() {
        assert_eq!(scopes::SANDBOXES, "sandbox");
    }

    #[test]
    fn scope_metrics() {
        assert_eq!(scopes::METRICS, "metrics");
    }

    #[test]
    fn scope_global() {
        assert_eq!(scopes::GLOBAL, "global");
    }

    #[test]
    fn scope_background() {
        assert_eq!(scopes::BACKGROUND, "background");
    }

    #[test]
    fn scope_templates() {
        assert_eq!(scopes::TEMPLATES, "template");
    }

    #[test]
    fn scope_snapshots() {
        assert_eq!(scopes::SNAPSHOTS, "snapshot");
    }

    #[test]
    fn scope_events() {
        assert_eq!(scopes::EVENTS, "event");
    }

    #[test]
    fn scope_queue() {
        assert_eq!(scopes::QUEUE, "queue");
    }

    #[test]
    fn scope_observability() {
        assert_eq!(scopes::OBSERVABILITY, "observability");
    }

    #[test]
    fn scope_networks() {
        assert_eq!(scopes::NETWORKS, "network");
    }

    #[test]
    fn scope_volumes() {
        assert_eq!(scopes::VOLUMES, "volume");
    }

    #[test]
    fn scope_alerts() {
        assert_eq!(scopes::ALERTS, "alert");
    }

    #[test]
    fn scope_alert_events() {
        assert_eq!(scopes::ALERT_EVENTS, "alert_event");
    }

    #[test]
    fn all_scopes_non_empty() {
        let all = [
            scopes::SANDBOXES,
            scopes::METRICS,
            scopes::GLOBAL,
            scopes::BACKGROUND,
            scopes::TEMPLATES,
            scopes::SNAPSHOTS,
            scopes::EVENTS,
            scopes::QUEUE,
            scopes::OBSERVABILITY,
            scopes::NETWORKS,
            scopes::VOLUMES,
            scopes::ALERTS,
            scopes::ALERT_EVENTS,
        ];
        for s in all {
            assert!(!s.is_empty(), "scope constant must not be empty");
        }
    }
}
