#![allow(dead_code)]
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;

use crate::types::{ExecResult, FileInfo, FileMetadata, SandboxConfig, SandboxMetrics};

#[derive(Debug, Clone, PartialEq)]
pub enum IsolationBackend {
    Docker,
    #[cfg(feature = "firecracker")]
    Firecracker,
}

impl std::fmt::Display for IsolationBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Docker => write!(f, "docker"),
            #[cfg(feature = "firecracker")]
            Self::Firecracker => write!(f, "firecracker"),
        }
    }
}

#[async_trait]
pub trait SandboxRuntime: Send + Sync + 'static {
    async fn ensure_image(&self, image: &str) -> Result<(), String>;

    async fn create_sandbox(
        &self,
        id: &str,
        config: &SandboxConfig,
        entrypoint: Option<&[String]>,
    ) -> Result<(), String>;
    async fn stop_sandbox(&self, container_name: &str) -> Result<(), String>;
    async fn remove_sandbox(&self, container_name: &str, force: bool) -> Result<(), String>;
    async fn pause_sandbox(&self, container_name: &str) -> Result<(), String>;
    async fn unpause_sandbox(&self, container_name: &str) -> Result<(), String>;

    async fn exec_in_sandbox(
        &self,
        container_name: &str,
        command: &[String],
        timeout_ms: u64,
    ) -> Result<ExecResult, String>;
    async fn exec_detached(
        &self,
        container_name: &str,
        command: &[String],
        attach_output: bool,
    ) -> Result<String, String>;

    async fn copy_to_sandbox(
        &self,
        container_name: &str,
        path: &str,
        content: &[u8],
    ) -> Result<(), String>;
    async fn copy_from_sandbox(
        &self,
        container_name: &str,
        path: &str,
    ) -> Result<Vec<u8>, String>;
    async fn list_dir(
        &self,
        container_name: &str,
        path: &str,
    ) -> Result<Vec<FileInfo>, String>;
    async fn search_files(
        &self,
        container_name: &str,
        dir: &str,
        pattern: &str,
    ) -> Result<Vec<String>, String>;
    async fn file_info(
        &self,
        container_name: &str,
        paths: &[String],
    ) -> Result<Vec<FileMetadata>, String>;

    async fn sandbox_stats(
        &self,
        container_name: &str,
        sandbox_id: &str,
    ) -> Result<SandboxMetrics, String>;
    async fn sandbox_logs(
        &self,
        container_name: &str,
        follow: bool,
        tail: &str,
    ) -> Result<Vec<Value>, String>;
    async fn sandbox_top(&self, container_name: &str) -> Result<Value, String>;

    async fn sandbox_exists(&self, container_name: &str) -> Result<bool, String>;
    async fn sandbox_ip(&self, container_name: &str) -> Result<String, String>;
    async fn sandbox_port_bindings(
        &self,
        container_name: &str,
    ) -> Result<HashMap<String, Option<u16>>, String>;

    async fn commit_sandbox(
        &self,
        container_name: &str,
        repo: &str,
        comment: &str,
    ) -> Result<String, String>;
    async fn inspect_image_size(&self, image_id: &str) -> Result<u64, String>;
    async fn remove_image(&self, image_id: &str) -> Result<(), String>;

    async fn create_pool_sandbox(
        &self,
        container_name: &str,
        config: &SandboxConfig,
    ) -> Result<(), String>;

    async fn create_network(
        &self,
        name: &str,
        driver: &str,
        labels: HashMap<String, String>,
    ) -> Result<String, String>;
    async fn remove_network(&self, network_id: &str) -> Result<(), String>;
    async fn connect_network(
        &self,
        network_id: &str,
        container: &str,
    ) -> Result<(), String>;
    async fn disconnect_network(
        &self,
        network_id: &str,
        container: &str,
        force: bool,
    ) -> Result<(), String>;

    async fn create_volume(
        &self,
        name: &str,
        labels: HashMap<String, String>,
    ) -> Result<(), String>;
    async fn remove_volume(&self, name: &str) -> Result<(), String>;

    async fn resize_exec(&self, exec_id: &str, width: u16, height: u16) -> Result<(), String>;

    fn backend(&self) -> IsolationBackend;
    fn as_any(&self) -> &dyn std::any::Any;
}

pub mod docker;
#[cfg(feature = "firecracker")]
pub mod fc_agent;
#[cfg(feature = "firecracker")]
pub mod fc_api;
#[cfg(feature = "firecracker")]
pub mod fc_network;
#[cfg(feature = "firecracker")]
pub mod fc_rootfs;
#[cfg(feature = "firecracker")]
pub mod fc_types;
#[cfg(feature = "firecracker")]
pub mod firecracker;
