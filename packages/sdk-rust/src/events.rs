use std::collections::HashMap;
use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{EventHistoryResponse, SandboxEvent};
use crate::util::url_encode;

pub struct EventManager {
    client: Arc<HttpClient>,
}

#[derive(Debug, Clone, Default)]
pub struct EventHistoryOptions {
    pub sandbox_id: Option<String>,
    pub topic: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl EventManager {
    pub fn new(client: Arc<HttpClient>) -> Self {
        Self { client }
    }

    pub async fn history(
        &self,
        options: Option<EventHistoryOptions>,
    ) -> Result<EventHistoryResponse> {
        let mut params = Vec::new();
        if let Some(ref opts) = options {
            if let Some(ref sandbox_id) = opts.sandbox_id {
                params.push(format!("sandboxId={}", url_encode(sandbox_id)));
            }
            if let Some(ref topic) = opts.topic {
                params.push(format!("topic={}", url_encode(topic)));
            }
            if let Some(limit) = opts.limit {
                params.push(format!("limit={limit}"));
            }
            if let Some(offset) = opts.offset {
                params.push(format!("offset={offset}"));
            }
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        self.client
            .get(&format!("/sandbox/events/history{query}"))
            .await
    }

    pub async fn publish(
        &self,
        topic: &str,
        sandbox_id: &str,
        data: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<SandboxEvent> {
        self.client
            .post(
                "/sandbox/events/publish",
                Some(&serde_json::json!({
                    "topic": topic,
                    "sandboxId": sandbox_id,
                    "data": data,
                })),
            )
            .await
    }
}
