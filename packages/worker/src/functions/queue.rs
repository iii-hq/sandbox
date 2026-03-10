use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{ExecResult, QueueJob, Sandbox};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

pub fn register(iii: &Arc<III>, kv: &StateKV, _config: &EngineConfig) {
    // queue::submit
    {
        let kv = kv.clone();
        let iii2 = iii.clone();
        iii.register_function_with_description("queue::submit", "Submit a command for async execution", move |input: Value| {
            let kv = kv.clone();
            let iii2 = iii2.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let command = input.get("command").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("command is required".into()))?;

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }

                let job_id = generate_id("job");
                let max_retries = input.get("maxRetries").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
                let job = QueueJob {
                    id: job_id.clone(), sandbox_id: id.to_string(),
                    command: command.to_string(), status: "pending".to_string(),
                    result: None, error: None, retries: 0, max_retries,
                    created_at: now_ms(), started_at: None, completed_at: None,
                };
                kv.set(scopes::QUEUE, &job_id, &job).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                let _ = iii2.trigger_void("queue::process", json!({ "jobId": &job_id }));
                serde_json::to_value(&job).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // queue::status
    {
        let kv = kv.clone();
        iii.register_function_with_description("queue::status", "Get queued job status", move |input: Value| {
            let kv = kv.clone();
            async move {
                let job_id = input.get("jobId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("jobId is required".into()))?;
                let job: QueueJob = kv.get(scopes::QUEUE, job_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Queue job not found: {job_id}")))?;
                serde_json::to_value(&job).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // queue::cancel
    {
        let kv = kv.clone();
        iii.register_function_with_description("queue::cancel", "Cancel a queued job", move |input: Value| {
            let kv = kv.clone();
            async move {
                let job_id = input.get("jobId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("jobId is required".into()))?;
                let mut job: QueueJob = kv.get(scopes::QUEUE, job_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Queue job not found: {job_id}")))?;
                if job.status != "pending" {
                    return Err(iii_sdk::IIIError::Handler(format!("Job is not pending: {}", job.status)));
                }
                job.status = "cancelled".to_string();
                job.completed_at = Some(now_ms());
                kv.set(scopes::QUEUE, job_id, &job).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "cancelled": job_id }))
            }
        });
    }

    // queue::dlq
    {
        let kv = kv.clone();
        iii.register_function_with_description("queue::dlq", "List dead letter queue entries", move |input: Value| {
            let kv = kv.clone();
            async move {
                let all: Vec<QueueJob> = kv.list(scopes::QUEUE).await;
                let failed: Vec<&QueueJob> = all.iter().filter(|j| j.status == "failed").collect();
                let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let limit = input.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let total = failed.len();
                let sliced: Vec<&&QueueJob> = failed.iter().skip(offset).take(limit).collect();
                Ok(json!({ "jobs": sliced, "total": total }))
            }
        });
    }

    // queue::process
    {
        let kv = kv.clone();
        let iii2 = iii.clone();
        iii.register_function_with_description("queue::process", "Process next queued job", move |input: Value| {
            let kv = kv.clone();
            let iii2 = iii2.clone();
            async move {
                let job_id = input.get("jobId").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("jobId is required".into()))?;
                let mut job: QueueJob = kv.get(scopes::QUEUE, job_id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Queue job not found: {job_id}")))?;
                if job.status != "pending" {
                    return serde_json::to_value(&job).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()));
                }

                job.status = "running".to_string();
                job.started_at = Some(now_ms());
                kv.set(scopes::QUEUE, &job.id, &job).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                match iii2.trigger("cmd::run", json!({ "id": job.sandbox_id, "command": job.command })).await {
                    Ok(result_val) => {
                        let result: ExecResult = serde_json::from_value(result_val).unwrap_or(ExecResult {
                            exit_code: -1, stdout: String::new(), stderr: "parse error".into(), duration: 0,
                        });
                        job.status = "completed".to_string();
                        job.result = Some(result);
                        job.completed_at = Some(now_ms());
                    }
                    Err(e) => {
                        job.retries += 1;
                        if job.retries >= job.max_retries {
                            job.status = "failed".to_string();
                            job.error = Some(e.to_string());
                            job.completed_at = Some(now_ms());
                        } else {
                            job.status = "pending".to_string();
                            job.started_at = None;
                        }
                    }
                }

                let should_retry = job.status == "pending";
                kv.set(scopes::QUEUE, &job.id, &job).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                if should_retry {
                    let _ = iii2.trigger_void("queue::process", json!({ "jobId": &job.id }));
                }
                serde_json::to_value(&job).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }
}
