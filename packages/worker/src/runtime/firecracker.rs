use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::types::{ExecResult, FileInfo, FileMetadata, SandboxConfig, SandboxMetrics};
use super::{IsolationBackend, SandboxRuntime};

pub struct FirecrackerRuntime {
    pub socket_dir: PathBuf,
    pub kernel_path: PathBuf,
    pub rootfs_path: PathBuf,
    pub vcpus: u32,
    pub mem_size_mib: u64,
}

impl FirecrackerRuntime {
    pub fn new(
        socket_dir: PathBuf,
        kernel_path: PathBuf,
        rootfs_path: PathBuf,
        vcpus: u32,
        mem_size_mib: u64,
    ) -> Self {
        Self {
            socket_dir,
            kernel_path,
            rootfs_path,
            vcpus,
            mem_size_mib,
        }
    }
}

#[async_trait]
impl SandboxRuntime for FirecrackerRuntime {
    async fn ensure_image(&self, _image: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn create_sandbox(
        &self,
        _id: &str,
        _config: &SandboxConfig,
        _entrypoint: Option<&[String]>,
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn stop_sandbox(&self, _container_name: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn remove_sandbox(&self, _container_name: &str, _force: bool) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn pause_sandbox(&self, _container_name: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn unpause_sandbox(&self, _container_name: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn exec_in_sandbox(
        &self,
        _container_name: &str,
        _command: &[String],
        _timeout_ms: u64,
    ) -> Result<ExecResult, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn exec_detached(
        &self,
        _container_name: &str,
        _command: &[String],
        _attach_output: bool,
    ) -> Result<String, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn copy_to_sandbox(
        &self,
        _container_name: &str,
        _path: &str,
        _content: &[u8],
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn copy_from_sandbox(
        &self,
        _container_name: &str,
        _path: &str,
    ) -> Result<Vec<u8>, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn list_dir(
        &self,
        _container_name: &str,
        _path: &str,
    ) -> Result<Vec<FileInfo>, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn search_files(
        &self,
        _container_name: &str,
        _dir: &str,
        _pattern: &str,
    ) -> Result<Vec<String>, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn file_info(
        &self,
        _container_name: &str,
        _paths: &[String],
    ) -> Result<Vec<FileMetadata>, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn sandbox_stats(
        &self,
        _container_name: &str,
        _sandbox_id: &str,
    ) -> Result<SandboxMetrics, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn sandbox_logs(
        &self,
        _container_name: &str,
        _follow: bool,
        _tail: &str,
    ) -> Result<Vec<Value>, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn sandbox_top(&self, _container_name: &str) -> Result<Value, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn sandbox_exists(&self, _container_name: &str) -> Result<bool, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn sandbox_ip(&self, _container_name: &str) -> Result<String, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn sandbox_port_bindings(
        &self,
        _container_name: &str,
    ) -> Result<HashMap<String, Option<u16>>, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn commit_sandbox(
        &self,
        _container_name: &str,
        _repo: &str,
        _comment: &str,
    ) -> Result<String, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn inspect_image_size(&self, _image_id: &str) -> Result<u64, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn remove_image(&self, _image_id: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn create_pool_sandbox(
        &self,
        _container_name: &str,
        _config: &SandboxConfig,
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn create_network(
        &self,
        _name: &str,
        _driver: &str,
        _labels: HashMap<String, String>,
    ) -> Result<String, String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn remove_network(&self, _network_id: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn connect_network(
        &self,
        _network_id: &str,
        _container: &str,
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn disconnect_network(
        &self,
        _network_id: &str,
        _container: &str,
        _force: bool,
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn create_volume(
        &self,
        _name: &str,
        _labels: HashMap<String, String>,
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn remove_volume(&self, _name: &str) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    async fn resize_exec(
        &self,
        _exec_id: &str,
        _width: u16,
        _height: u16,
    ) -> Result<(), String> {
        Err("Firecracker runtime not yet implemented".to_string())
    }

    fn backend(&self) -> IsolationBackend {
        IsolationBackend::Firecracker
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
