use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{
    NetworkConnectResponse, NetworkDeleteResponse, NetworkDisconnectResponse, NetworkListResponse,
    SandboxNetwork,
};

pub struct NetworkManager {
    client: Arc<HttpClient>,
}

impl NetworkManager {
    pub fn new(client: Arc<HttpClient>) -> Self {
        Self { client }
    }

    pub async fn create(
        &self,
        name: &str,
        driver: Option<&str>,
    ) -> Result<SandboxNetwork> {
        self.client
            .post(
                "/sandbox/networks",
                Some(&serde_json::json!({
                    "name": name,
                    "driver": driver,
                })),
            )
            .await
    }

    pub async fn list(&self) -> Result<NetworkListResponse> {
        self.client.get("/sandbox/networks").await
    }

    pub async fn connect(
        &self,
        network_id: &str,
        sandbox_id: &str,
    ) -> Result<NetworkConnectResponse> {
        self.client
            .post(
                &format!("/sandbox/networks/{network_id}/connect"),
                Some(&serde_json::json!({ "sandboxId": sandbox_id })),
            )
            .await
    }

    pub async fn disconnect(
        &self,
        network_id: &str,
        sandbox_id: &str,
    ) -> Result<NetworkDisconnectResponse> {
        self.client
            .post(
                &format!("/sandbox/networks/{network_id}/disconnect"),
                Some(&serde_json::json!({ "sandboxId": sandbox_id })),
            )
            .await
    }

    pub async fn delete(&self, network_id: &str) -> Result<NetworkDeleteResponse> {
        self.client
            .delete(&format!("/sandbox/networks/{network_id}"))
            .await
    }
}
