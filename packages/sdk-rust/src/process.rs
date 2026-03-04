use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{ProcessKillResponse, ProcessListResponse, ProcessTopResponse};

pub struct ProcessManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl ProcessManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn list(&self) -> Result<ProcessListResponse> {
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/processes",
                self.sandbox_id
            ))
            .await
    }

    pub async fn kill(&self, pid: i64, signal: Option<&str>) -> Result<ProcessKillResponse> {
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/processes/kill",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "pid": pid, "signal": signal })),
            )
            .await
    }

    pub async fn top(&self) -> Result<ProcessTopResponse> {
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/processes/top",
                self.sandbox_id
            ))
            .await
    }
}
