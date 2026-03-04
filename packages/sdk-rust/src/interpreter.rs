use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{CodeResult, InstallResponse, KernelSpec};

pub struct CodeInterpreter {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

impl CodeInterpreter {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn run(&self, code: &str, language: Option<&str>) -> Result<CodeResult> {
        let lang = language.unwrap_or("python");
        self.client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/interpret/execute",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "code": code, "language": lang })),
            )
            .await
    }

    pub async fn install(&self, packages: &[&str], manager: Option<&str>) -> Result<String> {
        let mgr = manager.unwrap_or("pip");
        let resp: InstallResponse = self
            .client
            .post(
                &format!(
                    "/sandbox/sandboxes/{}/interpret/install",
                    self.sandbox_id
                ),
                Some(&serde_json::json!({ "packages": packages, "manager": mgr })),
            )
            .await?;
        Ok(resp.output)
    }

    pub async fn kernels(&self) -> Result<Vec<KernelSpec>> {
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/interpret/kernels",
                self.sandbox_id
            ))
            .await
    }
}
