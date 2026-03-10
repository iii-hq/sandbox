use async_trait::async_trait;
use bollard::container::RemoveContainerOptions;
use bollard::image::CommitContainerOptions;
use bollard::exec::{CreateExecOptions, ResizeExecOptions};
use bollard::network::CreateNetworkOptions;
use bollard::volume::CreateVolumeOptions;
use bollard::Docker;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

use crate::types::{ExecResult, FileInfo, FileMetadata, SandboxConfig, SandboxMetrics};
use super::{IsolationBackend, SandboxRuntime};

#[allow(dead_code)]
pub struct DockerRuntime {
    docker: Arc<Docker>,
}

impl DockerRuntime {
    pub fn new(docker: Arc<Docker>) -> Self {
        Self { docker }
    }

    pub fn docker(&self) -> &Docker {
        &self.docker
    }

    pub fn docker_arc(&self) -> Arc<Docker> {
        Arc::clone(&self.docker)
    }
}

#[async_trait]
impl SandboxRuntime for DockerRuntime {
    async fn ensure_image(&self, image: &str) -> Result<(), String> {
        crate::docker::ensure_image(&self.docker, image).await
    }

    async fn create_sandbox(
        &self,
        id: &str,
        config: &SandboxConfig,
        entrypoint: Option<&[String]>,
    ) -> Result<(), String> {
        crate::docker::create_container(&self.docker, id, config, entrypoint).await
    }

    async fn stop_sandbox(&self, container_name: &str) -> Result<(), String> {
        self.docker
            .stop_container(container_name, None)
            .await
            .map_err(|e| format!("Failed to stop container: {e}"))
    }

    async fn remove_sandbox(&self, container_name: &str, force: bool) -> Result<(), String> {
        self.docker
            .remove_container(
                container_name,
                Some(RemoveContainerOptions {
                    force,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| format!("Failed to remove container: {e}"))
    }

    async fn pause_sandbox(&self, container_name: &str) -> Result<(), String> {
        self.docker
            .pause_container(container_name)
            .await
            .map_err(|e| format!("Failed to pause container: {e}"))
    }

    async fn unpause_sandbox(&self, container_name: &str) -> Result<(), String> {
        self.docker
            .unpause_container(container_name)
            .await
            .map_err(|e| format!("Failed to unpause container: {e}"))
    }

    async fn exec_in_sandbox(
        &self,
        container_name: &str,
        command: &[String],
        timeout_ms: u64,
    ) -> Result<ExecResult, String> {
        crate::docker::exec_in_container(&self.docker, container_name, command, timeout_ms).await
    }

    async fn exec_detached(
        &self,
        container_name: &str,
        command: &[String],
        attach_output: bool,
    ) -> Result<String, String> {
        let exec = self
            .docker
            .create_exec(
                container_name,
                CreateExecOptions {
                    cmd: Some(command.iter().map(|s| s.as_str()).collect()),
                    attach_stdout: Some(attach_output),
                    attach_stderr: Some(attach_output),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("Failed to create exec: {e}"))?;

        self.docker
            .start_exec(&exec.id, None)
            .await
            .map_err(|e| format!("Failed to start exec: {e}"))?;

        Ok(exec.id)
    }

    async fn copy_to_sandbox(
        &self,
        container_name: &str,
        path: &str,
        content: &[u8],
    ) -> Result<(), String> {
        crate::docker::copy_to_container(&self.docker, container_name, path, content).await
    }

    async fn copy_from_sandbox(
        &self,
        container_name: &str,
        path: &str,
    ) -> Result<Vec<u8>, String> {
        crate::docker::copy_from_container(&self.docker, container_name, path).await
    }

    async fn list_dir(
        &self,
        container_name: &str,
        path: &str,
    ) -> Result<Vec<FileInfo>, String> {
        crate::docker::list_container_dir(&self.docker, container_name, path).await
    }

    async fn search_files(
        &self,
        container_name: &str,
        dir: &str,
        pattern: &str,
    ) -> Result<Vec<String>, String> {
        crate::docker::search_in_container(&self.docker, container_name, dir, pattern).await
    }

    async fn file_info(
        &self,
        container_name: &str,
        paths: &[String],
    ) -> Result<Vec<FileMetadata>, String> {
        crate::docker::get_file_info(&self.docker, container_name, paths).await
    }

    async fn sandbox_stats(
        &self,
        container_name: &str,
        sandbox_id: &str,
    ) -> Result<SandboxMetrics, String> {
        crate::docker::get_container_stats(&self.docker, container_name, sandbox_id).await
    }

    async fn sandbox_logs(
        &self,
        container_name: &str,
        follow: bool,
        tail: &str,
    ) -> Result<Vec<Value>, String> {
        crate::docker::container_logs(&self.docker, container_name, follow, tail).await
    }

    async fn sandbox_top(&self, container_name: &str) -> Result<Value, String> {
        crate::docker::container_top(&self.docker, container_name).await
    }

    async fn sandbox_exists(&self, container_name: &str) -> Result<bool, String> {
        match self.docker.inspect_container(container_name, None).await {
            Ok(_) => Ok(true),
            Err(bollard::errors::Error::DockerResponseServerError {
                status_code: 404, ..
            }) => Ok(false),
            Err(e) => Err(format!("Failed to inspect container: {e}")),
        }
    }

    async fn sandbox_ip(&self, container_name: &str) -> Result<String, String> {
        let info = self
            .docker
            .inspect_container(container_name, None)
            .await
            .map_err(|e| format!("Failed to inspect container: {e}"))?;

        let ip = info
            .network_settings
            .and_then(|ns| ns.networks)
            .and_then(|nets| {
                nets.values()
                    .next()
                    .and_then(|n| n.ip_address.clone())
            })
            .unwrap_or_default();

        Ok(ip)
    }

    async fn sandbox_port_bindings(
        &self,
        container_name: &str,
    ) -> Result<HashMap<String, Option<u16>>, String> {
        let info = self
            .docker
            .inspect_container(container_name, None)
            .await
            .map_err(|e| format!("Failed to inspect container: {e}"))?;

        let mut result = HashMap::new();
        if let Some(ports) = info.network_settings.and_then(|ns| ns.ports) {
            for (key, bindings) in ports {
                let host_port = bindings
                    .and_then(|b| b.first().cloned())
                    .and_then(|b| b.host_port)
                    .and_then(|p| p.parse::<u16>().ok());
                result.insert(key, host_port);
            }
        }
        Ok(result)
    }

    async fn commit_sandbox(
        &self,
        container_name: &str,
        repo: &str,
        comment: &str,
    ) -> Result<String, String> {
        let opts = CommitContainerOptions {
            container: container_name.to_string(),
            repo: repo.to_string(),
            comment: comment.to_string(),
            ..Default::default()
        };

        let response = self
            .docker
            .commit_container(opts, bollard::container::Config::<String>::default())
            .await
            .map_err(|e| format!("Failed to commit container: {e}"))?;

        Ok(response.id.unwrap_or_default())
    }

    async fn inspect_image_size(&self, image_id: &str) -> Result<u64, String> {
        let info = self
            .docker
            .inspect_image(image_id)
            .await
            .map_err(|e| format!("Failed to inspect image: {e}"))?;

        Ok(info.size.unwrap_or(0) as u64)
    }

    async fn remove_image(&self, image_id: &str) -> Result<(), String> {
        self.docker
            .remove_image(image_id, None, None)
            .await
            .map_err(|e| format!("Failed to remove image: {e}"))?;
        Ok(())
    }

    async fn create_pool_sandbox(
        &self,
        container_name: &str,
        config: &SandboxConfig,
    ) -> Result<(), String> {
        crate::docker::create_pool_container(&self.docker, container_name, config).await
    }

    async fn create_network(
        &self,
        name: &str,
        driver: &str,
        labels: HashMap<String, String>,
    ) -> Result<String, String> {
        let opts = CreateNetworkOptions {
            name: name.to_string(),
            driver: driver.to_string(),
            labels,
            ..Default::default()
        };

        let response = self
            .docker
            .create_network(opts)
            .await
            .map_err(|e| format!("Failed to create network: {e}"))?;

        Ok(response.id)
    }

    async fn remove_network(&self, network_id: &str) -> Result<(), String> {
        self.docker
            .remove_network(network_id)
            .await
            .map_err(|e| format!("Failed to remove network: {e}"))
    }

    async fn connect_network(
        &self,
        network_id: &str,
        container: &str,
    ) -> Result<(), String> {
        let opts = bollard::network::ConnectNetworkOptions {
            container: container.to_string(),
            ..Default::default()
        };

        self.docker
            .connect_network(network_id, opts)
            .await
            .map_err(|e| format!("Failed to connect network: {e}"))
    }

    async fn disconnect_network(
        &self,
        network_id: &str,
        container: &str,
        force: bool,
    ) -> Result<(), String> {
        let opts = bollard::network::DisconnectNetworkOptions {
            container: container.to_string(),
            force,
        };

        self.docker
            .disconnect_network(network_id, opts)
            .await
            .map_err(|e| format!("Failed to disconnect network: {e}"))
    }

    async fn create_volume(
        &self,
        name: &str,
        labels: HashMap<String, String>,
    ) -> Result<(), String> {
        let opts = CreateVolumeOptions {
            name: name.to_string(),
            labels,
            ..Default::default()
        };

        self.docker
            .create_volume(opts)
            .await
            .map_err(|e| format!("Failed to create volume: {e}"))?;
        Ok(())
    }

    async fn remove_volume(&self, name: &str) -> Result<(), String> {
        self.docker
            .remove_volume(name, None)
            .await
            .map_err(|e| format!("Failed to remove volume: {e}"))
    }

    async fn resize_exec(&self, exec_id: &str, width: u16, height: u16) -> Result<(), String> {
        let opts = ResizeExecOptions { height, width };

        self.docker
            .resize_exec(exec_id, opts)
            .await
            .map_err(|e| format!("Failed to resize exec: {e}"))
    }

    fn backend(&self) -> IsolationBackend {
        IsolationBackend::Docker
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
