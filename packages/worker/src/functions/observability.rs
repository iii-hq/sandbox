use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{Sandbox, TraceRecord};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, kv: &StateKV, _config: &EngineConfig) {
    // observability::record-trace
    {
        let kv = kv.clone();
        iii.register_function_with_description("observability::record-trace", "Record a function execution trace", move |input: Value| {
            let kv = kv.clone();
            async move {
                let function_id = input.get("functionId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("functionId is required".into()))?;
                let duration = input.get("duration").and_then(|v| v.as_u64())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("duration is required".into()))?;
                let status = input.get("status").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("status is required".into()))?;

                let trace = TraceRecord {
                    id: generate_id("trc"),
                    function_id: function_id.to_string(),
                    sandbox_id: input.get("sandboxId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    duration,
                    status: status.to_string(),
                    error: input.get("error").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    timestamp: now_ms(),
                };
                kv.set(scopes::OBSERVABILITY, &trace.id, &trace).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&trace).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // observability::traces
    {
        let kv = kv.clone();
        iii.register_function_with_description("observability::traces", "Query execution traces", move |input: Value| {
            let kv = kv.clone();
            async move {
                let mut traces: Vec<TraceRecord> = kv.list(scopes::OBSERVABILITY).await;
                if let Some(sandbox_id) = input.get("sandboxId").and_then(|v| v.as_str()) {
                    traces.retain(|t| t.sandbox_id.as_deref() == Some(sandbox_id));
                }
                if let Some(function_id) = input.get("functionId").and_then(|v| v.as_str()) {
                    traces.retain(|t| t.function_id == function_id);
                }
                traces.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
                let total = traces.len();
                let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let limit = input.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
                let sliced: Vec<&TraceRecord> = traces.iter().skip(offset).take(limit).collect();
                Ok(json!({ "traces": sliced, "total": total }))
            }
        });
    }

    // observability::metrics
    {
        let kv = kv.clone();
        iii.register_function_with_description("observability::metrics", "Get aggregated observability metrics", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let traces: Vec<TraceRecord> = kv.list(scopes::OBSERVABILITY).await;
                let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;

                let total_requests = traces.len();
                let total_errors = traces.iter().filter(|t| t.status == "error").count();
                let mut durations: Vec<u64> = traces.iter().map(|t| t.duration).collect();
                durations.sort_unstable();
                let avg_duration = if total_requests > 0 {
                    durations.iter().sum::<u64>() as f64 / total_requests as f64
                } else { 0.0 };
                let p95_duration = if total_requests > 0 {
                    durations.get((total_requests as f64 * 0.95) as usize)
                        .or_else(|| durations.last())
                        .copied()
                        .unwrap_or(0) as f64
                } else { 0.0 };

                let mut function_counts: HashMap<String, u64> = HashMap::new();
                for t in &traces {
                    *function_counts.entry(t.function_id.clone()).or_insert(0) += 1;
                }

                Ok(json!({
                    "totalRequests": total_requests,
                    "totalErrors": total_errors,
                    "avgDuration": avg_duration,
                    "p95Duration": p95_duration,
                    "activeSandboxes": sandboxes.len(),
                    "functionCounts": function_counts,
                }))
            }
        });
    }

    // observability::clear
    {
        let kv = kv.clone();
        iii.register_function_with_description("observability::clear", "Clear old trace data", move |input: Value| {
            let kv = kv.clone();
            async move {
                let traces: Vec<TraceRecord> = kv.list(scopes::OBSERVABILITY).await;
                let cutoff = input.get("before").and_then(|v| v.as_u64()).unwrap_or(now_ms());
                let mut cleared = 0u64;
                for trace in &traces {
                    if trace.timestamp < cutoff {
                        let _ = kv.delete(scopes::OBSERVABILITY, &trace.id).await;
                        cleared += 1;
                    }
                }
                Ok(json!({ "cleared": cleared }))
            }
        });
    }
}
