use iii_sdk::III;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EngineConfig;
use crate::state::{generate_id, scopes, StateKV};
use crate::types::{SandboxConfig, SandboxTemplate};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

fn builtin_templates() -> Vec<SandboxTemplate> {
    let mut py_env = HashMap::new();
    py_env.insert("PYTHONUNBUFFERED".to_string(), "1".to_string());
    vec![
        SandboxTemplate {
            id: "tpl_python-data-science".into(),
            name: "python-data-science".into(),
            description: "Python with NumPy, Pandas, Matplotlib".into(),
            config: SandboxConfig {
                image: "python:3.12-slim".into(),
                memory: Some(1024), timeout: Some(7200),
                env: Some(py_env), name: None, cpu: None, network: None,
                workdir: None, metadata: None, entrypoint: None,
            },
            builtin: true, created_at: 0,
        },
        SandboxTemplate {
            id: "tpl_node-web".into(),
            name: "node-web".into(),
            description: "Node.js web development environment".into(),
            config: SandboxConfig {
                image: "node:20-slim".into(),
                memory: Some(512), timeout: Some(3600), network: Some(true),
                name: None, cpu: None, env: None, workdir: None, metadata: None, entrypoint: None,
            },
            builtin: true, created_at: 0,
        },
        SandboxTemplate {
            id: "tpl_go-api".into(),
            name: "go-api".into(),
            description: "Go API development environment".into(),
            config: SandboxConfig {
                image: "golang:1.22-alpine".into(),
                memory: Some(512), timeout: Some(3600), network: Some(true),
                name: None, cpu: None, env: None, workdir: None, metadata: None, entrypoint: None,
            },
            builtin: true, created_at: 0,
        },
        SandboxTemplate {
            id: "tpl_rust-cli".into(),
            name: "rust-cli".into(),
            description: "Rust CLI development environment".into(),
            config: SandboxConfig {
                image: "rust:1.77-slim".into(),
                memory: Some(1024), timeout: Some(7200),
                name: None, cpu: None, network: None, env: None,
                workdir: None, metadata: None, entrypoint: None,
            },
            builtin: true, created_at: 0,
        },
    ]
}

pub fn register(bridge: &Arc<III>, kv: &StateKV, _config: &EngineConfig) {
    {
        let kv2 = kv.clone();
        tokio::spawn(async move {
            for tpl in builtin_templates() {
                let existing: Option<SandboxTemplate> = kv2.get(scopes::TEMPLATES, &tpl.id).await;
                if existing.is_none() {
                    let _ = kv2.set(scopes::TEMPLATES, &tpl.id, &tpl).await;
                }
            }
        });
    }

    // template::create
    {
        let kv = kv.clone();
        bridge.register_function("template::create", move |input: Value| {
            let kv = kv.clone();
            async move {
                let name = input.get("name").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("name is required".into()))?;
                let description = input.get("description").and_then(|v| v.as_str()).unwrap_or("");
                let config_val = input.get("config")
                    .ok_or_else(|| iii_sdk::IIIError::Handler("config is required".into()))?;

                let existing: Vec<SandboxTemplate> = kv.list(scopes::TEMPLATES).await;
                if existing.iter().any(|t| t.name == name) {
                    return Err(iii_sdk::IIIError::Handler(format!("Template with name already exists: {name}")));
                }

                let id = generate_id("tpl");
                let config: SandboxConfig = serde_json::from_value(config_val.clone())
                    .map_err(|e| iii_sdk::IIIError::Handler(format!("Invalid config: {e}")))?;

                let template = SandboxTemplate {
                    id: id.clone(), name: name.to_string(), description: description.to_string(),
                    config, builtin: false, created_at: now_ms(),
                };
                kv.set(scopes::TEMPLATES, &id, &template).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                serde_json::to_value(&template).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()))
            }
        });
    }

    // template::list
    {
        let kv = kv.clone();
        bridge.register_function("template::list", move |_input: Value| {
            let kv = kv.clone();
            async move {
                let templates: Vec<SandboxTemplate> = kv.list(scopes::TEMPLATES).await;
                Ok(json!({ "templates": templates }))
            }
        });
    }

    // template::get
    {
        let kv = kv.clone();
        bridge.register_function("template::get", move |input: Value| {
            let kv = kv.clone();
            async move {
                if let Some(id) = input.get("id").and_then(|v| v.as_str()) {
                    let tpl: SandboxTemplate = kv.get(scopes::TEMPLATES, id).await
                        .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Template not found: {id}")))?;
                    return serde_json::to_value(&tpl).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()));
                }
                if let Some(name) = input.get("name").and_then(|v| v.as_str()) {
                    let all: Vec<SandboxTemplate> = kv.list(scopes::TEMPLATES).await;
                    let tpl = all.iter().find(|t| t.name == name)
                        .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Template not found: {name}")))?;
                    return serde_json::to_value(tpl).map_err(|e| iii_sdk::IIIError::Serde(e.to_string()));
                }
                Err(iii_sdk::IIIError::Handler("Provide id or name to get a template".into()))
            }
        });
    }

    // template::delete
    {
        let kv = kv.clone();
        bridge.register_function("template::delete", move |input: Value| {
            let kv = kv.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let tpl: SandboxTemplate = kv.get(scopes::TEMPLATES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Template not found: {id}")))?;
                if tpl.builtin {
                    return Err(iii_sdk::IIIError::Handler("Cannot delete builtin template".into()));
                }
                kv.delete(scopes::TEMPLATES, id).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;
                Ok(json!({ "deleted": id }))
            }
        });
    }
}
