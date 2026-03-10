use reqwest::Client;
use serde_json::{json, Value};

pub struct TestContext {
    pub client: Client,
    pub base_url: String,
    pub token: String,
}

impl TestContext {
    pub fn new() -> Self {
        let base_url = std::env::var("TEST_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:3111".to_string());
        let token = std::env::var("TEST_AUTH_TOKEN")
            .unwrap_or_else(|_| "test-token".to_string());
        Self {
            client: Client::new(),
            base_url,
            token,
        }
    }

    pub async fn api(&self, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
        let prefix = std::env::var("TEST_API_PREFIX")
            .unwrap_or_else(|_| "/sandbox".to_string());
        let url = format!("{}{}{}", self.base_url, prefix, path);

        let mut builder = match method {
            "GET" => self.client.get(&url),
            "POST" => self.client.post(&url),
            "PUT" => self.client.put(&url),
            "DELETE" => self.client.delete(&url),
            "PATCH" => self.client.patch(&url),
            _ => panic!("Unsupported HTTP method: {}", method),
        };

        builder = builder
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json");

        if let Some(b) = body {
            builder = builder.json(&b);
        }

        let resp = builder.send().await.expect("HTTP request failed");
        let status = resp.status().as_u16();
        let body = resp.json::<Value>().await.unwrap_or(Value::Null);
        (status, body)
    }

    pub async fn create_sandbox(&self) -> String {
        let (status, body) = self.api("POST", "/sandboxes", Some(json!({
            "image": "alpine:3.19",
            "timeout": 120
        }))).await;
        assert!(
            status == 200 || status == 201,
            "Failed to create sandbox: status={status}, body={body}"
        );
        body.get("id")
            .or_else(|| body.get("body").and_then(|b| b.get("id")))
            .and_then(|v| v.as_str())
            .expect("Response missing sandbox id")
            .to_string()
    }

    pub async fn cleanup(&self, id: &str) {
        let _ = self.api("DELETE", &format!("/sandboxes/{id}"), None).await;
    }
}
