use std::collections::HashMap;
use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{EnvDeleteResponse, EnvGetResponse, EnvListResponse, EnvSetResponse};

pub struct EnvManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl EnvManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn get(&self, key: &str) -> Result<EnvGetResponse> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/env/get", self.sandbox_id),
                Some(&serde_json::json!({ "key": key })),
            )
            .await
    }

    pub async fn set(&self, vars: HashMap<String, String>) -> Result<EnvSetResponse> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/env", self.sandbox_id),
                Some(&serde_json::json!({ "vars": vars })),
            )
            .await
    }

    pub async fn list(&self) -> Result<EnvListResponse> {
        self.client
            .get(&format!("/sandbox/sandboxes/{}/env", self.sandbox_id))
            .await
    }

    pub async fn delete(&self, key: &str) -> Result<EnvDeleteResponse> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/env/delete", self.sandbox_id),
                Some(&serde_json::json!({ "key": key })),
            )
            .await
    }
}
