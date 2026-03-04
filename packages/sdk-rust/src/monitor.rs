use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{AlertDeleteResponse, AlertHistoryResponse, AlertListResponse, ResourceAlert};

pub struct MonitorManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl MonitorManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn set_alert(
        &self,
        metric: &str,
        threshold: f64,
        action: Option<&str>,
    ) -> Result<ResourceAlert> {
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/alerts",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({
                    "metric": metric,
                    "threshold": threshold,
                    "action": action,
                })),
            )
            .await
    }

    pub async fn list_alerts(&self) -> Result<AlertListResponse> {
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/alerts",
                self.sandbox_id
            ))
            .await
    }

    pub async fn delete_alert(&self, alert_id: &str) -> Result<AlertDeleteResponse> {
        self.client
            .delete(&format!("/sandbox/alerts/{alert_id}"))
            .await
    }

    pub async fn history(&self, limit: Option<i64>) -> Result<AlertHistoryResponse> {
        let query = match limit {
            Some(l) => format!("?limit={l}"),
            None => String::new(),
        };
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/alerts/history{}",
                self.sandbox_id, query
            ))
            .await
    }
}
