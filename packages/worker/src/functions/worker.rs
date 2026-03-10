use bollard::Docker;
use iii_sdk::III;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{scopes, StateKV};

pub const SANDBOX_SCOPED_FUNCTIONS: &[&str] = &[
    "sandbox::get",
    "sandbox::kill",
    "sandbox::pause",
    "sandbox::resume",
    "sandbox::renew",
    "sandbox::clone",
    "cmd::run",
    "cmd::background",
    "cmd::interrupt",
    "fs::read",
    "fs::write",
    "fs::delete",
    "fs::list",
    "fs::search",
    "fs::upload",
    "fs::download",
    "fs::info",
    "fs::move",
    "fs::mkdir",
    "fs::rmdir",
    "fs::chmod",
    "env::get",
    "env::set",
    "env::list",
    "env::delete",
    "git::clone",
    "git::status",
    "git::commit",
    "git::diff",
    "git::log",
    "git::branch",
    "git::checkout",
    "git::push",
    "git::pull",
    "proc::list",
    "proc::kill",
    "proc::top",
    "port::expose",
    "port::list",
    "port::unexpose",
    "snapshot::create",
    "snapshot::list",
    "snapshot::restore",
    "interp::execute",
    "interp::install",
    "interp::kernels",
    "metrics::sandbox",
    "monitor::set-alert",
    "monitor::list-alerts",
    "monitor::history",
    "queue::submit",
    "terminal::create",
    "terminal::resize",
    "terminal::close",
    "proxy::request",
    "proxy::config",
];

const WORKERS_SCOPE: &str = "workers";
const HEARTBEAT_TIMEOUT_MS: u64 = 30_000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerInfo {
    pub worker_id: String,
    pub hostname: String,
    pub active_sandboxes: usize,
    pub max_sandboxes: usize,
    pub cpu_percent: f64,
    pub last_heartbeat: u64,
}

fn count_sandboxes_for_worker(sandboxes: &[Value], worker_id: &str) -> usize {
    sandboxes
        .iter()
        .filter(|v| {
            v.get("workerId")
                .and_then(|w| w.as_str())
                .map(|w| w == worker_id)
                .unwrap_or(false)
                && v.get("status")
                    .and_then(|s| s.as_str())
                    .map(|s| s == "running" || s == "paused")
                    .unwrap_or(false)
        })
        .count()
}

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    {
        let kv = kv.clone();
        let cfg = config.clone();
        iii.register_function_with_description(
            "worker::heartbeat",
            "Report worker liveness and capacity",
            move |_input: Value| {
                let kv = kv.clone();
                let cfg = cfg.clone();
                async move {
                    let sandboxes: Vec<Value> = kv.list(scopes::SANDBOXES).await;
                    let active = count_sandboxes_for_worker(&sandboxes, &cfg.worker_name);

                    let info = WorkerInfo {
                        worker_id: cfg.worker_name.clone(),
                        hostname: std::env::var("HOSTNAME")
                            .unwrap_or_else(|_| cfg.worker_name.clone()),
                        active_sandboxes: active,
                        max_sandboxes: cfg.max_sandboxes,
                        cpu_percent: 0.0,
                        last_heartbeat: now_ms(),
                    };

                    kv.set(WORKERS_SCOPE, &cfg.worker_name, &info)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    serde_json::to_value(&info)
                        .map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
                }
            },
        );
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description(
            "worker::select",
            "Pick least-loaded worker for new sandbox placement",
            move |_input: Value| {
                let kv = kv.clone();
                async move {
                    let workers: Vec<WorkerInfo> = kv.list(WORKERS_SCOPE).await;
                    let now = now_ms();

                    let alive: Vec<&WorkerInfo> = workers
                        .iter()
                        .filter(|w| now.saturating_sub(w.last_heartbeat) < HEARTBEAT_TIMEOUT_MS)
                        .collect();

                    if alive.is_empty() {
                        return Err(iii_sdk::IIIError::Handler(
                            "No alive workers available".into(),
                        ));
                    }

                    let best = alive
                        .iter()
                        .min_by(|a, b| {
                            let ratio_a = if a.max_sandboxes == 0 {
                                f64::MAX
                            } else {
                                a.active_sandboxes as f64 / a.max_sandboxes as f64
                            };
                            let ratio_b = if b.max_sandboxes == 0 {
                                f64::MAX
                            } else {
                                b.active_sandboxes as f64 / b.max_sandboxes as f64
                            };
                            ratio_a
                                .partial_cmp(&ratio_b)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .unwrap();

                    Ok(json!({ "workerId": best.worker_id }))
                }
            },
        );
    }

    {
        let kv = kv.clone();
        iii.register_function_with_description(
            "worker::list",
            "List all registered workers with alive/dead counts",
            move |_input: Value| {
                let kv = kv.clone();
                async move {
                    let workers: Vec<WorkerInfo> = kv.list(WORKERS_SCOPE).await;
                    let now = now_ms();

                    let alive = workers
                        .iter()
                        .filter(|w| now.saturating_sub(w.last_heartbeat) < HEARTBEAT_TIMEOUT_MS)
                        .count();
                    let dead = workers.len() - alive;

                    Ok(json!({
                        "workers": serde_json::to_value(&workers).unwrap_or(Value::Array(vec![])),
                        "alive": alive,
                        "dead": dead,
                    }))
                }
            },
        );
    }

    {
        let kv = kv.clone();
        let dk = dk.clone();
        let cfg = config.clone();
        iii.register_function_with_description(
            "worker::reap",
            "Clean up dead workers and handle orphaned sandboxes",
            move |_input: Value| {
                let kv = kv.clone();
                let dk = dk.clone();
                let cfg = cfg.clone();
                async move {
                    let workers: Vec<WorkerInfo> = kv.list(WORKERS_SCOPE).await;
                    let now = now_ms();

                    let dead_workers: Vec<&WorkerInfo> = workers
                        .iter()
                        .filter(|w| now.saturating_sub(w.last_heartbeat) >= HEARTBEAT_TIMEOUT_MS)
                        .collect();

                    let mut reaped = 0u64;
                    let mut reassigned = 0u64;
                    let mut expired = 0u64;

                    for dead in &dead_workers {
                        let sandboxes: Vec<Value> = kv.list(scopes::SANDBOXES).await;

                        for sbx in &sandboxes {
                            let owner = sbx
                                .get("workerId")
                                .and_then(|w| w.as_str())
                                .unwrap_or("");
                            if owner != dead.worker_id {
                                continue;
                            }

                            let sbx_id = match sbx.get("id").and_then(|v| v.as_str()) {
                                Some(id) => id.to_string(),
                                None => continue,
                            };

                            let container_name = format!("iii-sbx-{sbx_id}");
                            let exists = dk.inspect_container(&container_name, None).await.is_ok();

                            if exists {
                                let mut updated = sbx.clone();
                                if let Some(obj) = updated.as_object_mut() {
                                    obj.insert(
                                        "workerId".to_string(),
                                        Value::String(cfg.worker_name.clone()),
                                    );
                                }
                                let _ = kv.set(scopes::SANDBOXES, &sbx_id, &updated).await;
                                reassigned += 1;
                            } else {
                                let mut updated = sbx.clone();
                                if let Some(obj) = updated.as_object_mut() {
                                    obj.insert(
                                        "status".to_string(),
                                        Value::String("expired".to_string()),
                                    );
                                }
                                let _ = kv.set(scopes::SANDBOXES, &sbx_id, &updated).await;
                                expired += 1;
                            }
                        }

                        let _ = kv.delete(WORKERS_SCOPE, &dead.worker_id).await;
                        reaped += 1;
                    }

                    Ok(json!({
                        "reaped": reaped,
                        "reassigned": reassigned,
                        "expired": expired,
                    }))
                }
            },
        );
    }

    {
        let kv = kv.clone();
        let cfg = config.clone();
        iii.register_function_with_description(
            "worker::migrate-ownership",
            "Backfill worker_id on sandboxes that lack it",
            move |_input: Value| {
                let kv = kv.clone();
                let cfg = cfg.clone();
                async move {
                    let sandboxes: Vec<Value> = kv.list(scopes::SANDBOXES).await;
                    let mut migrated = 0u64;

                    for sbx in &sandboxes {
                        let has_worker = sbx
                            .get("workerId")
                            .and_then(|w| w.as_str())
                            .map(|w| !w.is_empty())
                            .unwrap_or(false);

                        if has_worker {
                            continue;
                        }

                        let sbx_id = match sbx.get("id").and_then(|v| v.as_str()) {
                            Some(id) => id.to_string(),
                            None => continue,
                        };

                        let mut updated = sbx.clone();
                        if let Some(obj) = updated.as_object_mut() {
                            obj.insert(
                                "workerId".to_string(),
                                Value::String(cfg.worker_name.clone()),
                            );
                        }

                        let _ = kv.set(scopes::SANDBOXES, &sbx_id, &updated).await;
                        migrated += 1;
                    }

                    Ok(json!({ "migrated": migrated }))
                }
            },
        );
    }

    {
        let kv2 = kv.clone();
        let iii2 = iii.clone();
        iii.register_function_with_description(
            "worker::forward",
            "Forward a function call to a specific worker",
            move |input: Value| {
                let kv = kv2.clone();
                let iii = iii2.clone();
                async move {
                    let target_worker = input
                        .get("targetWorker")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler("targetWorker is required".into())
                        })?;

                    let function_id = input
                        .get("functionId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler("functionId is required".into())
                        })?;

                    let payload = input
                        .get("payload")
                        .cloned()
                        .unwrap_or(Value::Object(serde_json::Map::new()));

                    let worker_info: Option<WorkerInfo> =
                        kv.get(WORKERS_SCOPE, target_worker).await;
                    match worker_info {
                        None => Err(iii_sdk::IIIError::Handler(format!(
                            "Worker {target_worker} not found"
                        ))),
                        Some(w) => {
                            let now = now_ms();
                            if now.saturating_sub(w.last_heartbeat) >= HEARTBEAT_TIMEOUT_MS {
                                return Err(iii_sdk::IIIError::Handler(format!(
                                    "Worker {target_worker} is dead (heartbeat stale)"
                                )));
                            }

                            let scoped_fn =
                                format!("worker::{target_worker}::{function_id}");
                            iii.trigger(&scoped_fn, payload).await
                        }
                    }
                }
            },
        );
    }
}

pub fn register_scoped(iii: &Arc<III>, _dk: &Arc<Docker>, _kv: &StateKV, config: &EngineConfig) {
    let worker_id = &config.worker_name;

    for fn_name in SANDBOX_SCOPED_FUNCTIONS {
        let scoped_id = format!("worker::{worker_id}::{fn_name}");
        let fn_name_owned = fn_name.to_string();
        let iii2 = iii.clone();

        iii.register_function(&scoped_id, move |input: Value| {
            let iii2 = iii2.clone();
            let fn_name = fn_name_owned.clone();
            async move { iii2.trigger(&fn_name, input).await }
        });
    }
}

pub fn is_sandbox_scoped(fn_id: &str) -> bool {
    SANDBOX_SCOPED_FUNCTIONS.contains(&fn_id)
}

pub fn scoped_function_id(worker_id: &str, fn_id: &str) -> String {
    format!("worker::{worker_id}::{fn_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_worker(id: &str, active: usize, max: usize, heartbeat: u64) -> WorkerInfo {
        WorkerInfo {
            worker_id: id.to_string(),
            hostname: format!("{id}.local"),
            active_sandboxes: active,
            max_sandboxes: max,
            cpu_percent: 0.0,
            last_heartbeat: heartbeat,
        }
    }

    fn make_sandbox_value(id: &str, worker_id: Option<&str>, status: &str) -> Value {
        let mut obj = json!({
            "id": id,
            "name": id,
            "image": "python:3.12-slim",
            "status": status,
            "createdAt": 1000,
            "expiresAt": 9999999,
            "config": { "image": "python:3.12-slim" },
            "metadata": {},
        });
        if let Some(wid) = worker_id {
            obj.as_object_mut()
                .unwrap()
                .insert("workerId".to_string(), Value::String(wid.to_string()));
        }
        obj
    }

    #[test]
    fn worker_info_serializes_camel_case() {
        let info = make_worker("w1", 5, 50, 1000);
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["workerId"], "w1");
        assert_eq!(json["activeSandboxes"], 5);
        assert_eq!(json["maxSandboxes"], 50);
        assert_eq!(json["lastHeartbeat"], 1000);
        assert_eq!(json["cpuPercent"], 0.0);
        assert_eq!(json["hostname"], "w1.local");
    }

    #[test]
    fn worker_info_deserializes_from_camel_case() {
        let data = json!({
            "workerId": "w2",
            "hostname": "host2",
            "activeSandboxes": 10,
            "maxSandboxes": 100,
            "cpuPercent": 55.5,
            "lastHeartbeat": 2000,
        });
        let info: WorkerInfo = serde_json::from_value(data).unwrap();
        assert_eq!(info.worker_id, "w2");
        assert_eq!(info.active_sandboxes, 10);
        assert_eq!(info.max_sandboxes, 100);
        assert_eq!(info.cpu_percent, 55.5);
        assert_eq!(info.last_heartbeat, 2000);
    }

    #[test]
    fn worker_info_roundtrip() {
        let original = make_worker("roundtrip", 3, 25, 5000);
        let json_str = serde_json::to_string(&original).unwrap();
        let restored: WorkerInfo = serde_json::from_str(&json_str).unwrap();
        assert_eq!(restored.worker_id, original.worker_id);
        assert_eq!(restored.active_sandboxes, original.active_sandboxes);
        assert_eq!(restored.max_sandboxes, original.max_sandboxes);
        assert_eq!(restored.last_heartbeat, original.last_heartbeat);
    }

    #[test]
    fn count_sandboxes_for_worker_basic() {
        let sandboxes = vec![
            make_sandbox_value("sbx_1", Some("w1"), "running"),
            make_sandbox_value("sbx_2", Some("w1"), "running"),
            make_sandbox_value("sbx_3", Some("w2"), "running"),
            make_sandbox_value("sbx_4", Some("w1"), "expired"),
        ];
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w1"), 2);
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w2"), 1);
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w3"), 0);
    }

    #[test]
    fn count_sandboxes_includes_paused() {
        let sandboxes = vec![
            make_sandbox_value("sbx_1", Some("w1"), "running"),
            make_sandbox_value("sbx_2", Some("w1"), "paused"),
        ];
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w1"), 2);
    }

    #[test]
    fn count_sandboxes_excludes_expired() {
        let sandboxes = vec![
            make_sandbox_value("sbx_1", Some("w1"), "expired"),
            make_sandbox_value("sbx_2", Some("w1"), "killed"),
        ];
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w1"), 0);
    }

    #[test]
    fn count_sandboxes_missing_worker_id() {
        let sandboxes = vec![make_sandbox_value("sbx_1", None, "running")];
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w1"), 0);
    }

    #[test]
    fn count_sandboxes_empty_list() {
        let sandboxes: Vec<Value> = vec![];
        assert_eq!(count_sandboxes_for_worker(&sandboxes, "w1"), 0);
    }

    #[test]
    fn select_picks_least_loaded() {
        let now = now_ms();
        let workers = vec![
            make_worker("heavy", 40, 50, now),
            make_worker("light", 5, 50, now),
            make_worker("medium", 20, 50, now),
        ];

        let alive: Vec<&WorkerInfo> = workers
            .iter()
            .filter(|w| now.saturating_sub(w.last_heartbeat) < HEARTBEAT_TIMEOUT_MS)
            .collect();

        let best = alive
            .iter()
            .min_by(|a, b| {
                let ratio_a = a.active_sandboxes as f64 / a.max_sandboxes as f64;
                let ratio_b = b.active_sandboxes as f64 / b.max_sandboxes as f64;
                ratio_a
                    .partial_cmp(&ratio_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap();

        assert_eq!(best.worker_id, "light");
    }

    #[test]
    fn select_filters_dead_workers() {
        let now = now_ms();
        let stale = now - 60_000;
        let workers = vec![
            make_worker("dead", 0, 50, stale),
            make_worker("alive", 10, 50, now),
        ];

        let alive: Vec<&WorkerInfo> = workers
            .iter()
            .filter(|w| now.saturating_sub(w.last_heartbeat) < HEARTBEAT_TIMEOUT_MS)
            .collect();

        assert_eq!(alive.len(), 1);
        assert_eq!(alive[0].worker_id, "alive");
    }

    #[test]
    fn select_errors_when_no_alive_workers() {
        let now = now_ms();
        let stale = now - 60_000;
        let workers = vec![
            make_worker("dead1", 0, 50, stale),
            make_worker("dead2", 0, 50, stale),
        ];

        let alive: Vec<&WorkerInfo> = workers
            .iter()
            .filter(|w| now.saturating_sub(w.last_heartbeat) < HEARTBEAT_TIMEOUT_MS)
            .collect();

        assert!(alive.is_empty());
    }

    #[test]
    fn select_handles_zero_max_sandboxes() {
        let now = now_ms();
        let workers = vec![
            make_worker("zero-cap", 0, 0, now),
            make_worker("normal", 1, 50, now),
        ];

        let alive: Vec<&WorkerInfo> = workers
            .iter()
            .filter(|w| now.saturating_sub(w.last_heartbeat) < HEARTBEAT_TIMEOUT_MS)
            .collect();

        let best = alive
            .iter()
            .min_by(|a, b| {
                let ratio_a = if a.max_sandboxes == 0 {
                    f64::MAX
                } else {
                    a.active_sandboxes as f64 / a.max_sandboxes as f64
                };
                let ratio_b = if b.max_sandboxes == 0 {
                    f64::MAX
                } else {
                    b.active_sandboxes as f64 / b.max_sandboxes as f64
                };
                ratio_a
                    .partial_cmp(&ratio_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap();

        assert_eq!(best.worker_id, "normal");
    }

    #[test]
    fn heartbeat_timeout_boundary() {
        let now = now_ms();
        let exactly_at_boundary = now - HEARTBEAT_TIMEOUT_MS;
        let just_inside = now - HEARTBEAT_TIMEOUT_MS + 1;

        let w_dead = make_worker("boundary-dead", 0, 50, exactly_at_boundary);
        let w_alive = make_worker("boundary-alive", 0, 50, just_inside);

        assert!(now.saturating_sub(w_dead.last_heartbeat) >= HEARTBEAT_TIMEOUT_MS);
        assert!(now.saturating_sub(w_alive.last_heartbeat) < HEARTBEAT_TIMEOUT_MS);
    }

    #[test]
    fn sandbox_value_with_worker_id() {
        let sbx = make_sandbox_value("sbx_1", Some("w1"), "running");
        assert_eq!(sbx["workerId"], "w1");
        assert_eq!(sbx["status"], "running");
        assert_eq!(sbx["id"], "sbx_1");
    }

    #[test]
    fn sandbox_value_without_worker_id() {
        let sbx = make_sandbox_value("sbx_1", None, "running");
        assert!(sbx.get("workerId").is_none());
    }

    #[test]
    fn migrate_detects_missing_worker_id() {
        let sbx_no_owner = make_sandbox_value("sbx_1", None, "running");
        let sbx_with_owner = make_sandbox_value("sbx_2", Some("w1"), "running");
        let sbx_empty_owner = {
            let mut v = make_sandbox_value("sbx_3", None, "running");
            v.as_object_mut()
                .unwrap()
                .insert("workerId".to_string(), Value::String(String::new()));
            v
        };

        let needs_migrate = |v: &Value| -> bool {
            let has = v
                .get("workerId")
                .and_then(|w| w.as_str())
                .map(|w| !w.is_empty())
                .unwrap_or(false);
            !has
        };

        assert!(needs_migrate(&sbx_no_owner));
        assert!(!needs_migrate(&sbx_with_owner));
        assert!(needs_migrate(&sbx_empty_owner));
    }

    #[test]
    fn reap_identifies_dead_workers() {
        let now = now_ms();
        let workers = vec![
            make_worker("alive1", 5, 50, now),
            make_worker("dead1", 3, 50, now - 60_000),
            make_worker("alive2", 10, 50, now - 10_000),
            make_worker("dead2", 0, 50, now - 45_000),
        ];

        let dead: Vec<&WorkerInfo> = workers
            .iter()
            .filter(|w| now.saturating_sub(w.last_heartbeat) >= HEARTBEAT_TIMEOUT_MS)
            .collect();

        assert_eq!(dead.len(), 2);
        assert!(dead.iter().any(|w| w.worker_id == "dead1"));
        assert!(dead.iter().any(|w| w.worker_id == "dead2"));
    }

    #[test]
    fn now_ms_returns_positive() {
        let ts = now_ms();
        assert!(ts > 0);
    }

    #[test]
    fn workers_scope_constant() {
        assert_eq!(WORKERS_SCOPE, "workers");
    }

    #[test]
    fn heartbeat_timeout_constant() {
        assert_eq!(HEARTBEAT_TIMEOUT_MS, 30_000);
    }

    #[test]
    fn scoped_function_id_format() {
        let result = scoped_function_id("worker-1", "sandbox::get");
        assert_eq!(result, "worker::worker-1::sandbox::get");
    }

    #[test]
    fn scoped_function_id_format_nested() {
        let result = scoped_function_id("us-east-2", "fs::read");
        assert_eq!(result, "worker::us-east-2::fs::read");
    }

    #[test]
    fn is_sandbox_scoped_with_known_function() {
        assert!(is_sandbox_scoped("sandbox::get"));
        assert!(is_sandbox_scoped("cmd::run"));
        assert!(is_sandbox_scoped("fs::read"));
        assert!(is_sandbox_scoped("snapshot::create"));
        assert!(is_sandbox_scoped("metrics::sandbox"));
    }

    #[test]
    fn is_sandbox_scoped_create_returns_false() {
        assert!(!is_sandbox_scoped("sandbox::create"));
        assert!(!is_sandbox_scoped("sandbox::list"));
    }

    #[test]
    fn is_sandbox_scoped_non_sandbox_returns_false() {
        assert!(!is_sandbox_scoped("template::create"));
        assert!(!is_sandbox_scoped("network::create"));
        assert!(!is_sandbox_scoped("worker::heartbeat"));
        assert!(!is_sandbox_scoped("lifecycle::health"));
        assert!(!is_sandbox_scoped("metrics::global"));
    }

    #[test]
    fn forward_function_id_format() {
        let owner = "worker-2";
        let fn_id = "sandbox::get";
        let scoped = scoped_function_id(owner, fn_id);
        assert_eq!(scoped, "worker::worker-2::sandbox::get");
        assert!(scoped.starts_with("worker::"));
        assert!(scoped.ends_with(fn_id));
    }

    #[test]
    fn sandbox_scoped_functions_list_contains_core() {
        let expected = [
            "sandbox::get",
            "sandbox::kill",
            "sandbox::pause",
            "sandbox::resume",
            "cmd::run",
            "cmd::background",
            "fs::read",
            "fs::write",
            "fs::delete",
            "fs::list",
            "snapshot::create",
            "snapshot::list",
            "snapshot::restore",
            "metrics::sandbox",
        ];
        for f in &expected {
            assert!(
                SANDBOX_SCOPED_FUNCTIONS.contains(f),
                "{f} missing from SANDBOX_SCOPED_FUNCTIONS"
            );
        }
    }

    #[test]
    fn sandbox_scoped_functions_list_excludes_global() {
        let excluded = [
            "sandbox::create",
            "sandbox::list",
            "template::create",
            "template::list",
            "metrics::global",
            "worker::heartbeat",
            "worker::list",
            "lifecycle::health",
        ];
        for f in &excluded {
            assert!(
                !SANDBOX_SCOPED_FUNCTIONS.contains(f),
                "{f} should not be in SANDBOX_SCOPED_FUNCTIONS"
            );
        }
    }

    #[test]
    fn sandbox_scoped_functions_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for f in SANDBOX_SCOPED_FUNCTIONS {
            assert!(seen.insert(*f), "Duplicate in SANDBOX_SCOPED_FUNCTIONS: {f}");
        }
    }
}
