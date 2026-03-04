use std::pin::Pin;
use std::sync::Arc;

use futures_core::Stream;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{LogEvent, SandboxMetrics};

pub struct StreamManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl StreamManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub fn logs(
        &self,
        tail: Option<i64>,
        follow: Option<bool>,
    ) -> Pin<Box<dyn Stream<Item = Result<LogEvent>> + Send + '_>> {
        let mut params = Vec::new();
        if let Some(t) = tail {
            params.push(format!("tail={t}"));
        }
        if let Some(f) = follow {
            params.push(format!("follow={f}"));
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        let path = format!(
            "/sandbox/sandboxes/{}/stream/logs{}",
            self.sandbox_id, query
        );
        let inner = self.client.stream_get(&path);

        Box::pin(async_stream::stream! {
            use futures_util::StreamExt;
            let mut inner = std::pin::pin!(inner);
            while let Some(item) = inner.next().await {
                match item {
                    Ok(line) => {
                        match serde_json::from_str::<LogEvent>(&line) {
                            Ok(event) => {
                                let is_end = event.event_type == "end";
                                yield Ok(event);
                                if is_end {
                                    return;
                                }
                            }
                            Err(_) => continue,
                        }
                    }
                    Err(e) => {
                        yield Err(e);
                        return;
                    }
                }
            }
        })
    }

    pub fn metrics(
        &self,
        interval: Option<i64>,
    ) -> Pin<Box<dyn Stream<Item = Result<SandboxMetrics>> + Send + '_>> {
        let mut params = Vec::new();
        if let Some(i) = interval {
            params.push(format!("interval={i}"));
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        let path = format!(
            "/sandbox/sandboxes/{}/stream/metrics{}",
            self.sandbox_id, query
        );
        let inner = self.client.stream_get(&path);

        Box::pin(async_stream::stream! {
            use futures_util::StreamExt;
            let mut inner = std::pin::pin!(inner);
            while let Some(item) = inner.next().await {
                match item {
                    Ok(line) => {
                        match serde_json::from_str::<SandboxMetrics>(&line) {
                            Ok(metrics) => yield Ok(metrics),
                            Err(_) => continue,
                        }
                    }
                    Err(e) => {
                        yield Err(e);
                        return;
                    }
                }
            }
        })
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
