use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{PortListResponse, PortMapping, PortRemoveResponse};

pub struct PortManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl PortManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn expose(
        &self,
        container_port: i64,
        host_port: Option<i64>,
        protocol: Option<&str>,
    ) -> Result<PortMapping> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/ports", self.sandbox_id),
                Some(&serde_json::json!({
                    "containerPort": container_port,
                    "hostPort": host_port,
                    "protocol": protocol,
                })),
            )
            .await
    }

    pub async fn list(&self) -> Result<PortListResponse> {
        self.client
            .get(&format!("/sandbox/sandboxes/{}/ports", self.sandbox_id))
            .await
    }

    pub async fn unexpose(&self, container_port: i64) -> Result<PortRemoveResponse> {
        self.client
            .delete(&format!(
                "/sandbox/sandboxes/{}/ports?containerPort={container_port}",
                self.sandbox_id
            ))
            .await
    }
}
