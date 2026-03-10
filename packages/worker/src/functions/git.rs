use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::docker::exec_in_container;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

async fn git_exec(dk: &Docker, kv: &StateKV, id: &str, git_cmd: &str, path: Option<&str>) -> Result<Value, iii_sdk::IIIError> {
    let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
        .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
    if sandbox.status != "running" {
        return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
    }
    let dir = path.unwrap_or("/workspace");
    let full_cmd = format!("cd \"{dir}\" && {git_cmd}");
    let cmd = vec!["sh".to_string(), "-c".to_string(), full_cmd];
    let cn = format!("iii-sbx-{id}");
    let result = exec_in_container(dk, &cn, &cmd, 30000).await
        .map_err(|e| iii_sdk::IIIError::Handler(e))?;
    serde_json::to_value(&result).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
}

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    // git::clone
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::clone", "Clone a git repository into sandbox", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let url = input.get("url").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("url is required".into()))?;
                let branch = input.get("branch").and_then(|v| v.as_str());
                let depth = input.get("depth").and_then(|v| v.as_u64());
                let path = input.get("path").and_then(|v| v.as_str());

                if url.contains('`') || url.contains("$(") {
                    return Err(iii_sdk::IIIError::Handler("Invalid git URL".into()));
                }
                let safe_url = url.replace('\'', "'\\''");
                let mut cmd = "git clone".to_string();
                if let Some(b) = branch { cmd.push_str(&format!(" --branch \"{b}\"")); }
                if let Some(d) = depth { cmd.push_str(&format!(" --depth {d}")); }
                cmd.push_str(&format!(" '{safe_url}'"));
                if let Some(p) = path { cmd.push_str(&format!(" \"{p}\"")); }

                let sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;
                if sandbox.status != "running" {
                    return Err(iii_sdk::IIIError::Handler(format!("Sandbox is not running: {}", sandbox.status)));
                }
                let cn = format!("iii-sbx-{id}");
                let shell = vec!["sh".to_string(), "-c".to_string(), cmd];
                let result = exec_in_container(&dk, &cn, &shell, 30000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                serde_json::to_value(&result).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // git::status
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::status", "Get git working tree status", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());

                let branch_result = git_exec(&dk, &kv, id, "git rev-parse --abbrev-ref HEAD", path).await?;
                let branch_exec: crate::types::ExecResult = serde_json::from_value(branch_result).unwrap();
                let branch = branch_exec.stdout.trim().to_string();
                let branch = if branch.is_empty() { "HEAD".to_string() } else { branch };

                let status_result = git_exec(&dk, &kv, id, "git status --porcelain", path).await?;
                let status_exec: crate::types::ExecResult = serde_json::from_value(status_result).unwrap();

                let files: Vec<Value> = status_exec.stdout.lines()
                    .filter(|l| l.len() >= 4)
                    .map(|line| json!({
                        "status": line[..2].trim(),
                        "path": &line[3..],
                    }))
                    .collect();

                Ok(json!({
                    "branch": branch,
                    "clean": files.is_empty(),
                    "files": files,
                }))
            }
        });
    }

    // git::commit
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::commit", "Create a git commit", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let message = input.get("message").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("message is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                let all = input.get("all").and_then(|v| v.as_bool()).unwrap_or(false);

                let escaped = message.replace('\'', "'\\''");
                let mut cmd = String::new();
                if all { cmd.push_str("git add -A && "); }
                cmd.push_str(&format!("git commit -m '{escaped}'"));

                git_exec(&dk, &kv, id, &cmd, path).await
            }
        });
    }

    // git::diff
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::diff", "Show git diff output", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                let staged = input.get("staged").and_then(|v| v.as_bool()).unwrap_or(false);
                let file = input.get("file").and_then(|v| v.as_str());

                let mut cmd = "git diff".to_string();
                if staged { cmd.push_str(" --staged"); }
                if let Some(f) = file { cmd.push_str(&format!(" \"{f}\"")); }

                let result = git_exec(&dk, &kv, id, &cmd, path).await?;
                let exec: crate::types::ExecResult = serde_json::from_value(result).unwrap();
                Ok(json!({ "diff": exec.stdout }))
            }
        });
    }

    // git::log
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::log", "Show git commit history", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                let count = input.get("count").and_then(|v| v.as_u64()).unwrap_or(10);

                let cmd = format!("git log --format=\"%H\t%s\t%an\t%aI\" -{count}");
                let result = git_exec(&dk, &kv, id, &cmd, path).await?;
                let exec: crate::types::ExecResult = serde_json::from_value(result).unwrap();

                let entries: Vec<Value> = exec.stdout.trim().lines()
                    .filter(|l| !l.is_empty())
                    .map(|line| {
                        let parts: Vec<&str> = line.splitn(4, '\t').collect();
                        json!({
                            "hash": parts.first().unwrap_or(&""),
                            "message": parts.get(1).unwrap_or(&""),
                            "author": parts.get(2).unwrap_or(&""),
                            "date": parts.get(3).unwrap_or(&""),
                        })
                    })
                    .collect();
                Ok(json!({ "entries": entries }))
            }
        });
    }

    // git::branch
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::branch", "Create or list git branches", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                let name = input.get("name").and_then(|v| v.as_str());
                let delete = input.get("delete").and_then(|v| v.as_bool()).unwrap_or(false);

                if let Some(n) = name {
                    if delete {
                        git_exec(&dk, &kv, id, &format!("git branch -d \"{n}\""), path).await?;
                    } else {
                        git_exec(&dk, &kv, id, &format!("git checkout -b \"{n}\""), path).await?;
                    }
                }

                let result = git_exec(&dk, &kv, id, "git branch -a", path).await?;
                let exec: crate::types::ExecResult = serde_json::from_value(result).unwrap();
                let mut current = String::new();
                let branches: Vec<String> = exec.stdout.trim().lines()
                    .filter(|l| !l.is_empty())
                    .map(|line| {
                        let trimmed = line.trim();
                        if let Some(name) = trimmed.strip_prefix("* ") {
                            current = name.to_string();
                            name.to_string()
                        } else {
                            trimmed.to_string()
                        }
                    })
                    .collect();
                Ok(json!({ "branches": branches, "current": current }))
            }
        });
    }

    // git::checkout
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::checkout", "Switch git branch", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let git_ref = input.get("ref").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("ref is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                git_exec(&dk, &kv, id, &format!("git checkout \"{git_ref}\""), path).await
            }
        });
    }

    // git::push
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::push", "Push commits to remote", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                let remote = input.get("remote").and_then(|v| v.as_str());
                let branch = input.get("branch").and_then(|v| v.as_str());
                let force = input.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                let mut cmd = "git push".to_string();
                if let Some(r) = remote { cmd.push_str(&format!(" \"{r}\"")); }
                if let Some(b) = branch { cmd.push_str(&format!(" \"{b}\"")); }
                if force { cmd.push_str(" --force"); }
                git_exec(&dk, &kv, id, &cmd, path).await
            }
        });
    }

    // git::pull
    {
        let kv = kv.clone(); let dk = dk.clone();
        iii.register_function_with_description("git::pull", "Pull changes from remote", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let path = input.get("path").and_then(|v| v.as_str());
                let remote = input.get("remote").and_then(|v| v.as_str());
                let branch = input.get("branch").and_then(|v| v.as_str());
                let mut cmd = "git pull".to_string();
                if let Some(r) = remote { cmd.push_str(&format!(" \"{r}\"")); }
                if let Some(b) = branch { cmd.push_str(&format!(" \"{b}\"")); }
                git_exec(&dk, &kv, id, &cmd, path).await
            }
        });
    }
}
