use std::time::Duration;

use futures_core::Stream;
use reqwest::{Client, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{Result, SandboxError};
use crate::types::ClientConfig;

const DEFAULT_TIMEOUT_MS: u64 = 30_000;

pub struct HttpClient {
    client: Client,
    base_url: String,
    token: Option<String>,
}

impl HttpClient {
    pub fn new(config: ClientConfig) -> crate::error::Result<Self> {
        let timeout_ms = config.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .map_err(|e| SandboxError::ClientBuild(e.to_string()))?;

        Ok(Self {
            client,
            base_url: config.base_url.trim_end_matches('/').to_string(),
            token: config.token,
        })
    }

    fn apply_headers(&self, builder: RequestBuilder) -> RequestBuilder {
        let builder = builder.header("Content-Type", "application/json");
        match &self.token {
            Some(token) => builder.header("Authorization", format!("Bearer {token}")),
            None => builder,
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let req = self.apply_headers(self.client.get(&url));
        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(SandboxError::Http {
                method: "GET".into(),
                path: path.into(),
                status,
                body,
            });
        }
        let data = res.json::<T>().await?;
        Ok(data)
    }

    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.apply_headers(self.client.post(&url));
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(SandboxError::Http {
                method: "POST".into(),
                path: path.into(),
                status,
                body,
            });
        }
        let data = res.json::<T>().await?;
        Ok(data)
    }

    pub async fn post_no_body<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let req = self.apply_headers(self.client.post(&url));
        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(SandboxError::Http {
                method: "POST".into(),
                path: path.into(),
                status,
                body,
            });
        }
        let data = res.json::<T>().await?;
        Ok(data)
    }

    pub async fn post_empty(&self, path: &str, body: Option<&impl Serialize>) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.apply_headers(self.client.post(&url));
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(SandboxError::Http {
                method: "POST".into(),
                path: path.into(),
                status,
                body,
            });
        }
        Ok(())
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let req = self.apply_headers(self.client.delete(&url));
        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(SandboxError::Http {
                method: "DELETE".into(),
                path: path.into(),
                status,
                body,
            });
        }
        let data = res.json::<T>().await?;
        Ok(data)
    }

    pub async fn delete_empty(&self, path: &str) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        let req = self.apply_headers(self.client.delete(&url));
        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(SandboxError::Http {
                method: "DELETE".into(),
                path: path.into(),
                status,
                body,
            });
        }
        Ok(())
    }

    pub fn stream_post(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> impl Stream<Item = Result<String>> {
        let url = format!("{}{}", self.base_url, path);
        let path_owned = path.to_string();
        let mut req = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream");
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        if let Some(b) = body {
            req = req.json(&b);
        }

        async_stream::stream! {
            use futures_util::StreamExt;

            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    yield Err(SandboxError::Request(e));
                    return;
                }
            };

            if !res.status().is_success() {
                let status = res.status().as_u16();
                yield Err(SandboxError::Http {
                    method: "POST".into(),
                    path: path_owned,
                    status,
                    body: "stream request failed".into(),
                });
                return;
            }

            let mut buffer = String::new();
            let mut byte_stream = res.bytes_stream();

            while let Some(chunk_result) = byte_stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);
                        let lines: Vec<String> = buffer.split('\n').map(|s| s.to_string()).collect();
                        buffer = lines.last().cloned().unwrap_or_default();
                        for line in &lines[..lines.len().saturating_sub(1)] {
                            if let Some(data) = line.strip_prefix("data: ") {
                                yield Ok(data.to_string());
                            }
                        }
                    }
                    Err(e) => {
                        yield Err(SandboxError::Request(e));
                        return;
                    }
                }
            }

            if let Some(data) = buffer.strip_prefix("data: ") {
                yield Ok(data.to_string());
            }
        }
    }

    pub fn stream_get(&self, path: &str) -> impl Stream<Item = Result<String>> {
        let url = format!("{}{}", self.base_url, path);
        let path_owned = path.to_string();
        let mut req = self
            .client
            .get(&url)
            .header("Accept", "text/event-stream");
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("Bearer {token}"));
        }

        async_stream::stream! {
            use futures_util::StreamExt;

            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    yield Err(SandboxError::Request(e));
                    return;
                }
            };

            if !res.status().is_success() {
                let status = res.status().as_u16();
                yield Err(SandboxError::Http {
                    method: "GET".into(),
                    path: path_owned,
                    status,
                    body: "stream request failed".into(),
                });
                return;
            }

            let mut buffer = String::new();
            let mut byte_stream = res.bytes_stream();

            while let Some(chunk_result) = byte_stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);
                        let lines: Vec<String> = buffer.split('\n').map(|s| s.to_string()).collect();
                        buffer = lines.last().cloned().unwrap_or_default();
                        for line in &lines[..lines.len().saturating_sub(1)] {
                            if let Some(data) = line.strip_prefix("data: ") {
                                yield Ok(data.to_string());
                            }
                        }
                    }
                    Err(e) => {
                        yield Err(SandboxError::Request(e));
                        return;
                    }
                }
            }

            if let Some(data) = buffer.strip_prefix("data: ") {
                yield Ok(data.to_string());
            }
        }
    }
}
