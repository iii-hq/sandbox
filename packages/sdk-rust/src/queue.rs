use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{QueueCancelResponse, QueueDlqResponse, QueueJobInfo};

pub struct QueueManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

#[derive(Debug, Clone, Default)]
pub struct QueueSubmitOptions {
    pub max_retries: Option<i64>,
    pub timeout: Option<u64>,
}

impl QueueManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn submit(
        &self,
        command: &str,
        options: Option<QueueSubmitOptions>,
    ) -> Result<QueueJobInfo> {
        let mut body = serde_json::json!({ "command": command });
        if let Some(opts) = options {
            if let Some(max_retries) = opts.max_retries {
                body["maxRetries"] = serde_json::json!(max_retries);
            }
            if let Some(timeout) = opts.timeout {
                body["timeout"] = serde_json::json!(timeout);
            }
        }
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/exec/queue",
                    self.sandbox_id
                ),
                Some(&body),
            )
            .await
    }

    pub async fn status(&self, job_id: &str) -> Result<QueueJobInfo> {
        self.client
            .get(&format!("/sandbox/queue/{job_id}/status"))
            .await
    }

    pub async fn cancel(&self, job_id: &str) -> Result<QueueCancelResponse> {
        self.client
            .post_no_body(&format!("/sandbox/queue/{job_id}/cancel"))
            .await
    }

    pub async fn dlq(&self, limit: Option<i64>) -> Result<QueueDlqResponse> {
        let query = match limit {
            Some(l) => format!("?limit={l}"),
            None => String::new(),
        };
        self.client
            .get(&format!("/sandbox/queue/dlq{query}"))
            .await
    }
}
