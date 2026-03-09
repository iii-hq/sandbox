use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::docker::{container_top, exec_in_container};
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

const VALID_SIGNALS: &[&str] = &["TERM", "KILL", "INT", "HUP", "USR1", "USR2", "STOP", "CONT"];

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // proc::list
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("proc::list", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let top = container_top(&dk, &cn).await.map_err(|e| iii_sdk::IIIError::Handler(e))?;

                let titles: Vec<String> = top.get("Titles")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(|s| s.to_lowercase()).collect())
                    .unwrap_or_default();

                let pid_idx = titles.iter().position(|t| t == "pid").unwrap_or(0);
                let user_idx = titles.iter().position(|t| t == "user").unwrap_or(0);
                let cpu_idx = titles.iter().position(|t| t == "%cpu").unwrap_or(0);
                let mem_idx = titles.iter().position(|t| t == "%mem").unwrap_or(0);
                let cmd_idx = titles.iter().position(|t| t == "command").unwrap_or(0);

                let processes: Vec<Value> = top.get("Processes")
                    .and_then(|v| v.as_array())
                    .map(|rows| {
                        rows.iter().map(|row| {
                            let cols: Vec<&str> = row.as_array()
                                .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                                .unwrap_or_default();
                            json!({
                                "pid": cols.get(pid_idx).unwrap_or(&"0").parse::<u64>().unwrap_or(0),
                                "user": cols.get(user_idx).unwrap_or(&""),
                                "cpu": cols.get(cpu_idx).unwrap_or(&"0.0"),
                                "memory": cols.get(mem_idx).unwrap_or(&"0.0"),
                                "command": cols.get(cmd_idx).unwrap_or(&""),
                            })
                        }).collect()
                    })
                    .unwrap_or_default();

                Ok(json!({ "processes": processes }))
            }
        });
    }

    // proc::kill
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("proc::kill", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let pid = input.get("pid").and_then(|v| v.as_u64())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("pid is required".into()))?;
                let signal = input.get("signal").and_then(|v| v.as_str()).unwrap_or("TERM");

                if !VALID_SIGNALS.contains(&signal) {
                    return Err(iii_sdk::IIIError::Handler(format!(
                        "Invalid signal: {signal}. Allowed: {}", VALID_SIGNALS.join(", ")
                    )));
                }

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["kill".into(), format!("-{signal}"), pid.to_string()];
                exec_in_container(&dk, &cn, &cmd, 10000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                Ok(json!({ "killed": pid, "signal": signal }))
            }
        });
    }

    // proc::top
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function("proc::top", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let cmd = vec!["sh".into(), "-c".into(), "ps aux --no-headers".into()];
                let result = exec_in_container(&dk, &cn, &cmd, 10000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;

                let processes: Vec<Value> = result.stdout.lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|line| {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        json!({
                            "pid": parts.get(1).unwrap_or(&"0").parse::<u64>().unwrap_or(0),
                            "cpu": parts.get(2).unwrap_or(&"0.0"),
                            "mem": parts.get(3).unwrap_or(&"0.0"),
                            "vsz": parts.get(4).unwrap_or(&"0").parse::<u64>().unwrap_or(0),
                            "rss": parts.get(5).unwrap_or(&"0").parse::<u64>().unwrap_or(0),
                            "command": parts.get(10..).map(|s| s.join(" ")).unwrap_or_default(),
                        })
                    })
                    .collect();
                Ok(json!({ "processes": processes }))
            }
        });
    }
}
