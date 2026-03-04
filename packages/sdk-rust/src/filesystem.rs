use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::FileInfo;

pub struct FileSystem {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl FileSystem {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn read(&self, path: &str) -> Result<String> {
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/files/read",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "path": path })),
            )
            .await
    }

    pub async fn write(&self, path: &str, content: &str) -> Result<()> {
        self.client
            .post_empty(
                &format!(
                    "/sandbox/sandboxes/{}/files/write",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "path": path, "content": content })),
            )
            .await
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        self.client
            .post_empty(
                &format!(
                    "/sandbox/sandboxes/{}/files/delete",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "path": path })),
            )
            .await
    }

    pub async fn list(&self, path: Option<&str>) -> Result<Vec<FileInfo>> {
        let p = path.unwrap_or("/workspace");
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/files/list",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "path": p })),
            )
            .await
    }

    pub async fn search(&self, pattern: &str, dir: Option<&str>) -> Result<Vec<String>> {
        let d = dir.unwrap_or("/workspace");
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/files/search",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "pattern": pattern, "dir": d })),
            )
            .await
    }

    pub async fn upload(&self, path: &str, content: &str) -> Result<()> {
        self.client
            .post_empty(
                &format!(
                    "/sandbox/sandboxes/{}/files/upload",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "path": path, "content": content })),
            )
            .await
    }

    pub async fn download(&self, path: &str) -> Result<String> {
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/files/download",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "path": path })),
            )
            .await
    }
}
