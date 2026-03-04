pub mod client;
pub mod env;
pub mod error;
pub mod events;
pub mod filesystem;
pub mod git;
pub mod interpreter;
pub mod monitor;
pub mod network;
pub mod observability;
pub mod port;
pub mod process;
pub mod queue;
pub mod sandbox;
pub mod stream;
pub mod types;
pub(crate) mod util;
pub mod volume;

pub use client::HttpClient;
pub use error::{Result, SandboxError};
pub use events::EventManager;
pub use network::NetworkManager;
pub use observability::ObservabilityClient;
pub use sandbox::Sandbox;
pub use types::*;
pub use volume::VolumeManager;

use std::sync::Arc;

const DEFAULT_BASE_URL: &str = "http://localhost:3111";

fn make_client(config: Option<ClientConfig>) -> Result<HttpClient> {
    let base_url = config
        .as_ref()
        .map(|c| c.base_url.clone())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
    let token = config.as_ref().and_then(|c| c.token.clone());
    HttpClient::new(ClientConfig {
        base_url,
        token,
        timeout_ms: config.and_then(|c| c.timeout_ms),
    })
}

pub async fn create_sandbox(
    options: SandboxCreateOptions,
    config: Option<ClientConfig>,
) -> Result<Sandbox> {
    let client = Arc::new(make_client(config)?);

    let mut create_body = serde_json::to_value(&options)?;
    if let serde_json::Value::Object(ref mut map) = create_body {
        if !map.contains_key("image") {
            map.insert(
                "image".to_string(),
                serde_json::Value::String("python:3.12-slim".to_string()),
            );
        }
    }

    let info: SandboxInfo = client
        .post("/sandbox/sandboxes", Some(&create_body))
        .await?;
    Ok(Sandbox::new(client, info))
}

pub async fn list_sandboxes(config: Option<ClientConfig>) -> Result<Vec<SandboxInfo>> {
    let client = make_client(config)?;
    let res: SandboxListResponse = client.get("/sandbox/sandboxes").await?;
    Ok(res.items)
}

pub async fn get_sandbox(id: &str, config: Option<ClientConfig>) -> Result<Sandbox> {
    let client = Arc::new(make_client(config)?);
    let info: SandboxInfo = client.get(&format!("/sandbox/sandboxes/{id}")).await?;
    Ok(Sandbox::new(client, info))
}

pub async fn list_templates(config: Option<ClientConfig>) -> Result<Vec<SandboxTemplate>> {
    let client = make_client(config)?;
    let res: TemplateListResponse = client.get("/sandbox/templates").await?;
    Ok(res.templates)
}
