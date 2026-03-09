use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::docker::get_container_stats;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

static TOTAL_CREATED: AtomicU64 = AtomicU64::new(0);
static TOTAL_KILLED: AtomicU64 = AtomicU64::new(0);
static TOTAL_EXPIRED: AtomicU64 = AtomicU64::new(0);
static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

#[allow(dead_code)]
pub fn increment_created() { TOTAL_CREATED.fetch_add(1, Ordering::Relaxed); }
#[allow(dead_code)]
pub fn increment_killed() { TOTAL_KILLED.fetch_add(1, Ordering::Relaxed); }
#[allow(dead_code)]
pub fn increment_expired() { TOTAL_EXPIRED.fetch_add(1, Ordering::Relaxed); }

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV) {
    START_TIME.get_or_init(Instant::now);

    // metrics::sandbox
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("metrics::sandbox", "Get sandbox resource metrics", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                let cn = format!("iii-sbx-{id}");
                let stats = get_container_stats(&dk, &cn, id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                serde_json::to_value(&stats).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // metrics::global
    {
        let kv = kv.clone();
        iii.register_function_with_description("metrics::global", "Get global system metrics", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;
                let uptime = START_TIME.get().map(|s| s.elapsed().as_secs()).unwrap_or(0);
                Ok(json!({
                    "activeSandboxes": sandboxes.len(),
                    "totalCreated": TOTAL_CREATED.load(Ordering::Relaxed),
                    "totalKilled": TOTAL_KILLED.load(Ordering::Relaxed),
                    "totalExpired": TOTAL_EXPIRED.load(Ordering::Relaxed),
                    "uptimeSeconds": uptime,
                }))
            }
        });
    }
}
