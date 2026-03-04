use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{ObservabilityClearResponse, ObservabilityMetrics, TraceListResponse};
use crate::util::url_encode;

pub struct ObservabilityClient {
    client: Arc<HttpClient>,
}

#[derive(Debug, Clone, Default)]
pub struct TraceOptions {
    pub sandbox_id: Option<String>,
    pub function_id: Option<String>,
    pub limit: Option<i64>,
}

impl ObservabilityClient {
    pub fn new(client: Arc<HttpClient>) -> Self {
        Self { client }
    }

    pub async fn traces(&self, options: Option<TraceOptions>) -> Result<TraceListResponse> {
        let mut params = Vec::new();
        if let Some(ref opts) = options {
            if let Some(ref sandbox_id) = opts.sandbox_id {
                params.push(format!("sandboxId={}", url_encode(sandbox_id)));
            }
            if let Some(ref function_id) = opts.function_id {
                params.push(format!("functionId={}", url_encode(function_id)));
            }
            if let Some(limit) = opts.limit {
                params.push(format!("limit={limit}"));
            }
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        self.client
            .get(&format!("/sandbox/observability/traces{query}"))
            .await
    }

    pub async fn metrics(&self) -> Result<ObservabilityMetrics> {
        self.client
            .get("/sandbox/observability/metrics")
            .await
    }

    pub async fn clear(&self, before: Option<i64>) -> Result<ObservabilityClearResponse> {
        self.client
            .post(
                "/sandbox/observability/clear",
                Some(&serde_json::json!({ "before": before })),
            )
            .await
    }
}
