use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{AlertEvent, ResourceAlert, Sandbox};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

const VALID_METRICS: &[&str] = &["cpu", "memory", "pids"];
const VALID_ACTIONS: &[&str] = &["notify", "pause", "kill"];

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    // monitor::set-alert
    {
        let kv = kv.clone();
        iii.register_function_with_description("monitor::set-alert", "Set a resource usage alert", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;
                let metric = input.get("metric").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("metric is required".into()))?;
                let threshold = input.get("threshold").and_then(|v| v.as_f64())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("threshold is required".into()))?;
                let action = input.get("action").and_then(|v| v.as_str()).unwrap_or("notify");

                if !VALID_METRICS.contains(&metric) {
                    return Err(iii_sdk::IIIError::Handler(format!("Invalid metric: {metric}. Must be one of: {}", VALID_METRICS.join(", "))));
                }
                if metric == "pids" {
                    if !(1.0..=256.0).contains(&threshold) {
                        return Err(iii_sdk::IIIError::Handler("pids threshold must be between 1 and 256".into()));
                    }
                } else if !(0.0..=100.0).contains(&threshold) {
                    return Err(iii_sdk::IIIError::Handler(format!("{metric} threshold must be between 0 and 100")));
                }
                if !VALID_ACTIONS.contains(&action) {
                    return Err(iii_sdk::IIIError::Handler(format!("Invalid action: {action}. Must be one of: {}", VALID_ACTIONS.join(", "))));
                }

                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let alert_id = generate_id("alrt");
                let alert = ResourceAlert {
                    id: alert_id.clone(), sandbox_id: id.to_string(),
                    metric: metric.to_string(), threshold, action: action.to_string(),
                    triggered: false, last_checked: None, last_triggered: None,
                    created_at: now_ms(),
                };
                kv.set(scopes::ALERTS, &alert_id, &alert).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&alert).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // monitor::list-alerts
    {
        let kv = kv.clone();
        iii.register_function_with_description("monitor::list-alerts", "List active alerts", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;
                let all: Vec<ResourceAlert> = kv.list(scopes::ALERTS).await;
                let alerts: Vec<&ResourceAlert> = all.iter().filter(|a| a.sandbox_id == id).collect();
                Ok(json!({ "alerts": alerts }))
            }
        });
    }

    // monitor::delete-alert
    {
        let kv = kv.clone();
        iii.register_function_with_description("monitor::delete-alert", "Delete an alert", move |input: Value| {
            let kv = kv.clone();
            async move {
                let alert_id = input.get("alertId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("alertId is required".into()))?;
                let _alert: ResourceAlert = kv.get(scopes::ALERTS, alert_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Alert not found: {alert_id}")))?;
                kv.delete(scopes::ALERTS, alert_id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": alert_id }))
            }
        });
    }

    // monitor::history
    {
        let kv = kv.clone();
        iii.register_function_with_description("monitor::history", "Get alert trigger history", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("sandboxId is required".into()))?;
                let mut events: Vec<AlertEvent> = kv.list(scopes::ALERT_EVENTS).await;
                events.retain(|e| e.sandbox_id == id);
                events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
                let total = events.len();
                let limit = input.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                events.truncate(limit);
                Ok(json!({ "events": events, "total": total }))
            }
        });
    }

    // monitor::check
    {
        let kv = kv.clone(); let rt = rt.clone();
        let iii2 = iii.clone();
        iii.register_function_with_description("monitor::check", "Check all alerts against current metrics", move |_input: Value| {
            let kv = kv.clone(); let rt = rt.clone(); let iii2 = iii2.clone();
            async move {
                let mut alerts: Vec<ResourceAlert> = kv.list(scopes::ALERTS).await;
                let mut checked = 0u64;
                let mut triggered = 0u64;

                for alert in &mut alerts {
                    let sandbox: Option<Sandbox> = kv.get(scopes::SANDBOXES, &alert.sandbox_id).await;
                    let sandbox = match sandbox {
                        Some(s) if s.status == "running" => s,
                        _ => continue,
                    };

                    checked += 1;
                    let cn = format!("iii-sbx-{}", alert.sandbox_id);
                    let stats = match rt.sandbox_stats(&cn, &sandbox.id).await {
                        Ok(s) => s,
                        Err(_) => continue,
                    };

                    let value = match alert.metric.as_str() {
                        "cpu" => stats.cpu_percent,
                        "memory" => if stats.memory_limit_mb > 0 { (stats.memory_usage_mb as f64 / stats.memory_limit_mb as f64) * 100.0 } else { 0.0 },
                        _ => stats.pids as f64,
                    };

                    alert.last_checked = Some(now_ms());

                    if value >= alert.threshold {
                        triggered += 1;
                        alert.triggered = true;
                        alert.last_triggered = Some(now_ms());

                        let event = AlertEvent {
                            alert_id: alert.id.clone(),
                            sandbox_id: alert.sandbox_id.clone(),
                            metric: alert.metric.clone(),
                            value, threshold: alert.threshold,
                            action: alert.action.clone(),
                            timestamp: now_ms(),
                        };
                        let _ = kv.set(scopes::ALERT_EVENTS, &generate_id("aevt"), &event).await;

                        match alert.action.as_str() {
                            "pause" => { let _ = iii2.trigger("sandbox::pause", json!({ "id": alert.sandbox_id })).await; }
                            "kill" => { let _ = iii2.trigger("sandbox::kill", json!({ "id": alert.sandbox_id })).await; }
                            _ => {}
                        }
                    }
                    let _ = kv.set(scopes::ALERTS, &alert.id, alert).await;
                }
                Ok(json!({ "checked": checked, "triggered": triggered }))
            }
        });
    }
}
