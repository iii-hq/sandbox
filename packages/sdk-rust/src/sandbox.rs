use std::pin::Pin;
use std::sync::Arc;

use futures_core::Stream;

use crate::client::HttpClient;
use crate::env::EnvManager;
use crate::error::Result;
use crate::filesystem::FileSystem;
use crate::git::GitManager;
use crate::interpreter::CodeInterpreter;
use crate::monitor::MonitorManager;
use crate::port::PortManager;
use crate::process::ProcessManager;
use crate::queue::QueueManager;
use crate::stream::StreamManager;
use crate::types::{ExecResult, ExecStreamChunk, SandboxInfo, SandboxMetrics, SnapshotInfo, SnapshotListResponse};

pub struct Sandbox {
    client: Arc<HttpClient>,
    pub info: SandboxInfo,
    pub env: EnvManager,
    pub filesystem: FileSystem,
    pub git: GitManager,
    pub interpreter: CodeInterpreter,
    pub processes: ProcessManager,
    pub ports: PortManager,
    pub queue: QueueManager,
    pub streams: StreamManager,
    pub monitor: MonitorManager,
}

impl Sandbox {
    pub fn new(client: Arc<HttpClient>, info: SandboxInfo) -> Self {
        let id = info.id.clone();
        Self {
            env: EnvManager::new(Arc::clone(&client), id.clone()),
            filesystem: FileSystem::new(Arc::clone(&client), id.clone()),
            git: GitManager::new(Arc::clone(&client), id.clone()),
            interpreter: CodeInterpreter::new(Arc::clone(&client), id.clone()),
            processes: ProcessManager::new(Arc::clone(&client), id.clone()),
            ports: PortManager::new(Arc::clone(&client), id.clone()),
            queue: QueueManager::new(Arc::clone(&client), id.clone()),
            streams: StreamManager::new(Arc::clone(&client), id.clone()),
            monitor: MonitorManager::new(Arc::clone(&client), id),
            client,
            info,
        }
    }

    pub fn id(&self) -> &str {
        &self.info.id
    }

    pub fn status(&self) -> &str {
        &self.info.status
    }

    pub async fn exec(&self, command: &str, timeout: Option<u64>) -> Result<ExecResult> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/exec", self.info.id),
                Some(&serde_json::json!({
                    "command": command,
                    "timeout": timeout,
                })),
            )
            .await
    }

    pub fn exec_stream(
        &self,
        command: &str,
    ) -> Pin<Box<dyn Stream<Item = Result<ExecStreamChunk>> + Send + '_>> {
        let body = serde_json::json!({ "command": command });
        let inner = self.client.stream_post(
            &format!("/sandbox/sandboxes/{}/exec/stream", self.info.id),
            Some(body),
        );

        Box::pin(async_stream::stream! {
            use futures_util::StreamExt;
            let mut inner = std::pin::pin!(inner);
            while let Some(item) = inner.next().await {
                match item {
                    Ok(line) => {
                        match serde_json::from_str::<ExecStreamChunk>(&line) {
                            Ok(chunk) => {
                                let is_exit = chunk.chunk_type == "exit";
                                yield Ok(chunk);
                                if is_exit {
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

    pub async fn clone_sandbox(&self, name: Option<&str>) -> Result<SandboxInfo> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/clone", self.info.id),
                Some(&serde_json::json!({ "name": name })),
            )
            .await
    }

    pub async fn pause(&self) -> Result<()> {
        self.client
            .post_empty(
                &format!("/sandbox/sandboxes/{}/pause", self.info.id),
                None::<&serde_json::Value>,
            )
            .await
    }

    pub async fn resume(&self) -> Result<()> {
        self.client
            .post_empty(
                &format!("/sandbox/sandboxes/{}/resume", self.info.id),
                None::<&serde_json::Value>,
            )
            .await
    }

    pub async fn kill(&self) -> Result<()> {
        self.client
            .delete_empty(&format!("/sandbox/sandboxes/{}", self.info.id))
            .await
    }

    pub async fn metrics(&self) -> Result<SandboxMetrics> {
        self.client
            .get(&format!("/sandbox/sandboxes/{}/metrics", self.info.id))
            .await
    }

    pub async fn snapshot(&self, name: Option<&str>) -> Result<SnapshotInfo> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/snapshots", self.info.id),
                Some(&serde_json::json!({ "name": name })),
            )
            .await
    }

    pub async fn restore(&self, snapshot_id: &str) -> Result<SandboxInfo> {
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/snapshots/restore", self.info.id),
                Some(&serde_json::json!({ "snapshotId": snapshot_id })),
            )
            .await
    }

    pub async fn list_snapshots(&self) -> Result<SnapshotListResponse> {
        self.client
            .get(&format!("/sandbox/sandboxes/{}/snapshots", self.info.id))
            .await
    }

    pub async fn refresh(&mut self) -> Result<SandboxInfo> {
        let updated: SandboxInfo = self
            .client
            .get(&format!("/sandbox/sandboxes/{}", self.info.id))
            .await?;
        self.info = updated.clone();
        Ok(updated)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
