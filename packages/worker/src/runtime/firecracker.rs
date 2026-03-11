use async_trait::async_trait;
use bollard::Docker;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};

use crate::types::{ExecResult, FileInfo, FileMetadata, SandboxConfig, SandboxMetrics};
use super::{IsolationBackend, SandboxRuntime};
use super::fc_types::*;
use super::fc_api::FcClient;
use super::fc_agent::AgentClient;
use super::fc_network::{SubnetAllocator, SubnetInfo};

pub struct FirecrackerRuntime {
    config: FcConfig,
    vms: Arc<RwLock<HashMap<String, VmInstance>>>,
    subnet_allocator: Arc<Mutex<SubnetAllocator>>,
    docker: Arc<Docker>,
    next_cid: Arc<Mutex<u32>>,
}

impl FirecrackerRuntime {
    pub fn new(
        config: FcConfig,
        docker: Arc<Docker>,
    ) -> Self {
        let subnet_base = config.subnet_base;
        let cid_base = config.guest_cid_base;

        tracing::info!(
            kernel = %config.kernel_path.display(),
            socket_dir = %config.socket_dir.display(),
            "Firecracker runtime initialized"
        );

        Self {
            config,
            vms: Arc::new(RwLock::new(HashMap::new())),
            subnet_allocator: Arc::new(Mutex::new(SubnetAllocator::new(subnet_base))),
            docker,
            next_cid: Arc::new(Mutex::new(cid_base)),
        }
    }

    fn validate_vm_id(vm_id: &str) -> Result<(), String> {
        if vm_id.is_empty() {
            return Err("VM ID cannot be empty".to_string());
        }
        if vm_id.contains('/') || vm_id.contains('\\') || vm_id.contains("..") || vm_id.contains('\0') {
            return Err(format!("Invalid VM ID (path traversal): {vm_id}"));
        }
        Ok(())
    }

    fn socket_path(&self, vm_id: &str) -> PathBuf {
        self.config.socket_dir.join(format!("{vm_id}.sock"))
    }

    fn vsock_path(&self, vm_id: &str) -> PathBuf {
        self.config.socket_dir.join(format!("{vm_id}_vsock.sock"))
    }

    fn fc_client(&self, vm_id: &str) -> FcClient {
        FcClient::new(&self.socket_path(vm_id).to_string_lossy())
    }

    pub async fn agent_client(&self, vm_id: &str) -> Result<AgentClient, String> {
        let vms = self.vms.read().await;
        let vm = vms.get(vm_id)
            .ok_or_else(|| format!("VM not found: {vm_id}"))?;
        Ok(AgentClient::new(
            &self.vsock_path(vm_id).to_string_lossy(),
            vm.guest_cid,
        ))
    }

    async fn allocate_cid(&self) -> u32 {
        let mut cid = self.next_cid.lock().await;
        let allocated = *cid;
        *cid += 1;
        allocated
    }

    async fn start_firecracker_process(&self, vm_id: &str) -> Result<u32, String> {
        let socket_path = self.socket_path(vm_id);

        if let Some(parent) = socket_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create socket dir: {e}"))?;
        }

        if socket_path.exists() {
            tokio::fs::remove_file(&socket_path)
                .await
                .map_err(|e| format!("Failed to remove stale socket: {e}"))?;
        }

        let child = tokio::process::Command::new(&self.config.fc_binary)
            .arg("--api-sock")
            .arg(&socket_path)
            .arg("--id")
            .arg(vm_id)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start Firecracker: {e}"))?;

        let pid = child.id()
            .ok_or_else(|| "Failed to get Firecracker process ID".to_string())?;

        for _ in 0..50 {
            if socket_path.exists() {
                return Ok(pid);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Err(format!("Firecracker socket did not appear for {vm_id}"))
    }

    async fn configure_vm(
        &self,
        vm_id: &str,
        rootfs_path: &std::path::Path,
        vcpus: u32,
        mem_mib: u64,
        guest_cid: u32,
        subnet: &SubnetInfo,
    ) -> Result<(), String> {
        let client = self.fc_client(vm_id);

        let boot_args = format!(
            "console=ttyS0 reboot=k panic=1 pci=off \
             ip={guest_ip}::{host_ip}:{netmask}::eth0:off",
            guest_ip = subnet.guest_ip,
            host_ip = subnet.host_ip,
            netmask = subnet.netmask,
        );

        client
            .set_boot_source(&BootSource {
                kernel_image_path: self.config.kernel_path.to_string_lossy().to_string(),
                boot_args: Some(boot_args),
                initrd_path: None,
            })
            .await?;

        client
            .set_machine_config(&MachineConfig {
                vcpu_count: vcpus,
                mem_size_mib: mem_mib,
                smt: Some(false),
                track_dirty_pages: Some(true),
            })
            .await?;

        client
            .add_drive(&Drive {
                drive_id: "rootfs".to_string(),
                path_on_host: rootfs_path.to_string_lossy().to_string(),
                is_root_device: true,
                is_read_only: false,
                rate_limiter: None,
            })
            .await?;

        let tap_name = format!("{}{}", self.config.tap_prefix, subnet.subnet_id);
        let mac = super::fc_network::generate_mac(subnet.subnet_id);

        client
            .add_network_interface(&NetworkInterface {
                iface_id: "eth0".to_string(),
                guest_mac: mac,
                host_dev_name: tap_name,
                rx_rate_limiter: None,
                tx_rate_limiter: None,
            })
            .await?;

        let vsock_path = self.vsock_path(vm_id);
        client
            .set_vsock(&Vsock {
                vsock_id: "vsock0".to_string(),
                guest_cid,
                uds_path: vsock_path.to_string_lossy().to_string(),
            })
            .await?;

        Ok(())
    }

    async fn wait_for_agent(&self, vm_id: &str, guest_cid: u32) -> Result<(), String> {
        let agent = AgentClient::new(
            &self.vsock_path(vm_id).to_string_lossy(),
            guest_cid,
        );

        for attempt in 0..30 {
            if agent.health_check().await.unwrap_or(false) {
                tracing::info!(vm_id = %vm_id, attempt = attempt, "Guest agent ready");
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        Err(format!("Guest agent did not become ready in VM {vm_id}"))
    }

    #[allow(clippy::too_many_arguments)]
    async fn setup_vm(
        &self,
        id: &str,
        vm_rootfs: &std::path::Path,
        vcpus: u32,
        mem_mib: u64,
        guest_cid: u32,
        subnet: &SubnetInfo,
        tap_name: &str,
    ) -> Result<(), String> {
        super::fc_network::create_tap_device(tap_name, &subnet.host_ip).await?;

        let guest_subnet = format!("{}/30", subnet.guest_ip);
        super::fc_network::setup_nat(tap_name, &guest_subnet).await?;

        let pid = self.start_firecracker_process(id).await?;

        self.configure_vm(id, vm_rootfs, vcpus, mem_mib, guest_cid, subnet).await?;

        let client = self.fc_client(id);
        client.start_instance().await?;

        self.wait_for_agent(id, guest_cid).await?;

        let vm = VmInstance {
            id: id.to_string(),
            socket_path: self.socket_path(id),
            rootfs_path: vm_rootfs.to_path_buf(),
            pid: Some(pid),
            guest_cid,
            tap_name: tap_name.to_string(),
            guest_ip: subnet.guest_ip.clone(),
            host_ip: subnet.host_ip.clone(),
            state: VmLifecycleState::Running,
            vcpus,
            mem_mib,
            labels: HashMap::new(),
            port_mappings: HashMap::new(),
        };

        let mut vms = self.vms.write().await;
        vms.insert(id.to_string(), vm);

        tracing::info!(
            vm_id = %id,
            guest_ip = %subnet.guest_ip,
            cid = guest_cid,
            "Firecracker VM created"
        );

        Ok(())
    }

    fn strip_prefix(container_name: &str) -> &str {
        container_name.strip_prefix("iii-sbx-").unwrap_or(container_name)
    }
}

#[async_trait]
impl SandboxRuntime for FirecrackerRuntime {
    async fn ensure_image(&self, image: &str) -> Result<(), String> {
        crate::docker::ensure_image(&self.docker, image).await?;
        super::fc_rootfs::ensure_rootfs(
            &self.docker,
            image,
            &self.config.rootfs_cache_dir,
            &self.config.agent_path,
        )
        .await?;
        Ok(())
    }

    async fn create_sandbox(
        &self,
        id: &str,
        config: &SandboxConfig,
        _entrypoint: Option<&[String]>,
    ) -> Result<(), String> {
        Self::validate_vm_id(id)?;
        let vcpus = config.cpu.map(|c| c as u32).unwrap_or(self.config.default_vcpus);
        let mem_mib = config.memory.unwrap_or(self.config.default_mem_mib);

        let rootfs_path = super::fc_rootfs::ensure_rootfs(
            &self.docker,
            &config.image,
            &self.config.rootfs_cache_dir,
            &self.config.agent_path,
        )
        .await?;

        let vm_rootfs = self.config.rootfs_cache_dir.join(format!("{id}.ext4"));
        tokio::fs::copy(&rootfs_path, &vm_rootfs)
            .await
            .map_err(|e| format!("Failed to copy rootfs for VM: {e}"))?;

        let guest_cid = self.allocate_cid().await;

        let subnet = {
            let mut allocator = self.subnet_allocator.lock().await;
            allocator.allocate(id)?
        };

        let tap_name = format!("{}{}", self.config.tap_prefix, subnet.subnet_id);

        let result = self.setup_vm(id, &vm_rootfs, vcpus, mem_mib, guest_cid, &subnet, &tap_name).await;

        if let Err(e) = &result {
            tracing::error!(vm_id = %id, error = %e, "VM creation failed, cleaning up");
            let _ = tokio::fs::remove_file(&vm_rootfs).await;
            let guest_subnet = format!("{}/30", subnet.guest_ip);
            let _ = super::fc_network::teardown_nat(&tap_name, &guest_subnet).await;
            let _ = super::fc_network::delete_tap_device(&tap_name).await;
            let _ = tokio::fs::remove_file(&self.socket_path(id)).await;
            let _ = tokio::fs::remove_file(&self.vsock_path(id)).await;
            let mut allocator = self.subnet_allocator.lock().await;
            allocator.release(id);
        }

        result
    }

    async fn stop_sandbox(&self, container_name: &str) -> Result<(), String> {
        let vm_id = Self::strip_prefix(container_name);

        {
            let mut vms = self.vms.write().await;
            if let Some(vm) = vms.get_mut(vm_id) {
                vm.state = VmLifecycleState::Stopped;
            }
        }

        if let Some(pid) = self.vms.read().await.get(vm_id).and_then(|v| v.pid) {
            let _ = tokio::process::Command::new("kill")
                .arg(pid.to_string())
                .output()
                .await;
        }

        Ok(())
    }

    async fn remove_sandbox(&self, container_name: &str, force: bool) -> Result<(), String> {
        let vm_id = Self::strip_prefix(container_name);

        let vm = {
            let mut vms = self.vms.write().await;
            vms.remove(vm_id)
        };

        if let Some(vm) = vm {
            if vm.state == VmLifecycleState::Running || force {
                if let Some(pid) = vm.pid {
                    let _ = tokio::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output()
                        .await;
                }
            }

            let guest_subnet = format!("{}/30", vm.guest_ip);
            let _ = super::fc_network::teardown_nat(&vm.tap_name, &guest_subnet).await;
            let _ = super::fc_network::delete_tap_device(&vm.tap_name).await;

            let _ = tokio::fs::remove_file(&vm.socket_path).await;
            let _ = tokio::fs::remove_file(&vm.rootfs_path).await;
            let vsock_path = self.vsock_path(vm_id);
            let _ = tokio::fs::remove_file(&vsock_path).await;

            let mut allocator = self.subnet_allocator.lock().await;
            allocator.release(vm_id);
        }

        Ok(())
    }

    async fn pause_sandbox(&self, container_name: &str) -> Result<(), String> {
        let vm_id = Self::strip_prefix(container_name);
        let client = self.fc_client(vm_id);
        client.pause_instance().await?;

        let mut vms = self.vms.write().await;
        if let Some(vm) = vms.get_mut(vm_id) {
            vm.state = VmLifecycleState::Paused;
        }
        Ok(())
    }

    async fn unpause_sandbox(&self, container_name: &str) -> Result<(), String> {
        let vm_id = Self::strip_prefix(container_name);
        let client = self.fc_client(vm_id);
        client.resume_instance().await?;

        let mut vms = self.vms.write().await;
        if let Some(vm) = vms.get_mut(vm_id) {
            vm.state = VmLifecycleState::Running;
        }
        Ok(())
    }

    async fn exec_in_sandbox(
        &self,
        container_name: &str,
        command: &[String],
        timeout_ms: u64,
    ) -> Result<ExecResult, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.exec(command, timeout_ms).await
    }

    async fn exec_detached(
        &self,
        container_name: &str,
        command: &[String],
        _attach_output: bool,
    ) -> Result<String, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.exec_detached(command).await
    }

    async fn copy_to_sandbox(
        &self,
        container_name: &str,
        path: &str,
        content: &[u8],
    ) -> Result<(), String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.write_file(path, content).await
    }

    async fn copy_from_sandbox(
        &self,
        container_name: &str,
        path: &str,
    ) -> Result<Vec<u8>, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.read_file(path).await
    }

    async fn list_dir(
        &self,
        container_name: &str,
        path: &str,
    ) -> Result<Vec<FileInfo>, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.list_dir(path).await
    }

    async fn search_files(
        &self,
        container_name: &str,
        dir: &str,
        pattern: &str,
    ) -> Result<Vec<String>, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.search_files(dir, pattern).await
    }

    async fn file_info(
        &self,
        container_name: &str,
        paths: &[String],
    ) -> Result<Vec<FileMetadata>, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.file_info(paths).await
    }

    async fn sandbox_stats(
        &self,
        container_name: &str,
        sandbox_id: &str,
    ) -> Result<SandboxMetrics, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        agent.stats(sandbox_id).await
    }

    async fn sandbox_logs(
        &self,
        container_name: &str,
        _follow: bool,
        tail: &str,
    ) -> Result<Vec<Value>, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;

        let n: usize = tail.parse().unwrap_or(100);
        let result = agent
            .exec(
                &["journalctl".to_string(), "-n".to_string(), n.to_string(), "--no-pager".to_string(), "-o".to_string(), "json".to_string()],
                10000,
            )
            .await?;

        let logs: Vec<Value> = result
            .stdout
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();

        Ok(logs)
    }

    async fn sandbox_top(&self, container_name: &str) -> Result<Value, String> {
        let vm_id = Self::strip_prefix(container_name);
        let agent = self.agent_client(vm_id).await?;
        let processes = agent.processes().await?;
        serde_json::to_value(processes).map_err(|e| format!("Failed to serialize processes: {e}"))
    }

    async fn sandbox_exists(&self, container_name: &str) -> Result<bool, String> {
        let vm_id = Self::strip_prefix(container_name);
        let vms = self.vms.read().await;
        Ok(vms.contains_key(vm_id))
    }

    async fn sandbox_ip(&self, container_name: &str) -> Result<String, String> {
        let vm_id = Self::strip_prefix(container_name);
        let vms = self.vms.read().await;
        vms.get(vm_id)
            .map(|vm| vm.guest_ip.clone())
            .ok_or_else(|| format!("VM not found: {vm_id}"))
    }

    async fn sandbox_port_bindings(
        &self,
        container_name: &str,
    ) -> Result<HashMap<String, Option<u16>>, String> {
        let vm_id = Self::strip_prefix(container_name);
        let vms = self.vms.read().await;
        vms.get(vm_id)
            .map(|vm| vm.port_mappings.clone())
            .ok_or_else(|| format!("VM not found: {vm_id}"))
    }

    async fn commit_sandbox(
        &self,
        container_name: &str,
        _repo: &str,
        comment: &str,
    ) -> Result<String, String> {
        let vm_id = Self::strip_prefix(container_name);
        Self::validate_vm_id(vm_id)?;

        let client = self.fc_client(vm_id);
        client.pause_instance().await?;

        let snap_dir = self.config.snapshot_dir.join(vm_id);
        tokio::fs::create_dir_all(&snap_dir)
            .await
            .map_err(|e| format!("Failed to create snapshot dir: {e}"))?;

        let snapshot_path = snap_dir.join("snapshot.bin");
        let mem_path = snap_dir.join("mem.bin");

        client
            .create_snapshot(&SnapshotCreateParams {
                snapshot_type: "Full".to_string(),
                snapshot_path: snapshot_path.to_string_lossy().to_string(),
                mem_file_path: mem_path.to_string_lossy().to_string(),
            })
            .await?;

        client.resume_instance().await?;

        let snapshot_id = format!("fc-snap-{}__{}", vm_id, comment.replace(' ', "-"));
        tracing::info!(vm_id = %vm_id, snapshot_id = %snapshot_id, "VM snapshot created");

        Ok(snapshot_id)
    }

    async fn inspect_image_size(&self, image_id: &str) -> Result<u64, String> {
        if image_id.starts_with("fc-snap-") {
            let remainder = image_id.trim_start_matches("fc-snap-");
            let vm_id = remainder.split("__").next().unwrap_or(remainder);
            let snap_dir = self.config.snapshot_dir.join(vm_id);
            let snapshot_path = snap_dir.join("snapshot.bin");
            let mem_path = snap_dir.join("mem.bin");

            let mut total = 0u64;
            if let Ok(meta) = tokio::fs::metadata(&snapshot_path).await {
                total += meta.len();
            }
            if let Ok(meta) = tokio::fs::metadata(&mem_path).await {
                total += meta.len();
            }
            return Ok(total);
        }

        super::fc_rootfs::rootfs_size(&self.config.rootfs_cache_dir, image_id).await
    }

    async fn remove_image(&self, image_id: &str) -> Result<(), String> {
        if image_id.starts_with("fc-snap-") {
            let remainder = image_id.trim_start_matches("fc-snap-");
            let vm_id = remainder.split("__").next().unwrap_or(remainder);
            let snap_dir = self.config.snapshot_dir.join(vm_id);
            let _ = tokio::fs::remove_dir_all(&snap_dir).await;
            return Ok(());
        }

        super::fc_rootfs::remove_rootfs(&self.config.rootfs_cache_dir, image_id).await
    }

    async fn create_pool_sandbox(
        &self,
        container_name: &str,
        config: &SandboxConfig,
    ) -> Result<(), String> {
        let vm_id = Self::strip_prefix(container_name);
        self.create_sandbox(vm_id, config, None).await
    }

    async fn create_network(
        &self,
        name: &str,
        _driver: &str,
        _labels: HashMap<String, String>,
    ) -> Result<String, String> {
        tracing::warn!(name = %name, "Firecracker networks use TAP-based isolation; create_network is a no-op");
        Ok(format!("fc-net-{name}"))
    }

    async fn remove_network(&self, _network_id: &str) -> Result<(), String> {
        Ok(())
    }

    async fn connect_network(
        &self,
        _network_id: &str,
        _container: &str,
    ) -> Result<(), String> {
        tracing::warn!("Firecracker VMs have dedicated TAP interfaces; connect_network is a no-op");
        Ok(())
    }

    async fn disconnect_network(
        &self,
        _network_id: &str,
        _container: &str,
        _force: bool,
    ) -> Result<(), String> {
        Ok(())
    }

    async fn create_volume(
        &self,
        name: &str,
        _labels: HashMap<String, String>,
    ) -> Result<(), String> {
        Self::validate_vm_id(name)?;
        let vol_dir = self.config.rootfs_cache_dir.join("volumes").join(name);
        tokio::fs::create_dir_all(&vol_dir)
            .await
            .map_err(|e| format!("Failed to create volume dir: {e}"))?;
        Ok(())
    }

    async fn remove_volume(&self, name: &str) -> Result<(), String> {
        Self::validate_vm_id(name)?;
        let vol_dir = self.config.rootfs_cache_dir.join("volumes").join(name);
        if vol_dir.exists() {
            tokio::fs::remove_dir_all(&vol_dir)
                .await
                .map_err(|e| format!("Failed to remove volume: {e}"))?;
        }
        Ok(())
    }

    async fn resize_exec(
        &self,
        _exec_id: &str,
        _width: u16,
        _height: u16,
    ) -> Result<(), String> {
        Ok(())
    }

    fn backend(&self) -> IsolationBackend {
        IsolationBackend::Firecracker
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_prefix_with_iii_sbx() {
        assert_eq!(FirecrackerRuntime::strip_prefix("iii-sbx-abc123"), "abc123");
    }

    #[test]
    fn strip_prefix_without() {
        assert_eq!(FirecrackerRuntime::strip_prefix("some-id"), "some-id");
    }

    #[test]
    fn backend_is_firecracker() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let rt = FirecrackerRuntime::new(FcConfig::default(), docker);
        assert_eq!(rt.backend(), IsolationBackend::Firecracker);
    }

    #[test]
    fn socket_path_format() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let config = FcConfig {
            socket_dir: PathBuf::from("/tmp/fc-test"),
            ..Default::default()
        };
        let rt = FirecrackerRuntime::new(config, docker);
        let path = rt.socket_path("vm-abc");
        assert_eq!(path, PathBuf::from("/tmp/fc-test/vm-abc.sock"));
    }

    #[test]
    fn vsock_path_format() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let config = FcConfig {
            socket_dir: PathBuf::from("/tmp/fc-test"),
            ..Default::default()
        };
        let rt = FirecrackerRuntime::new(config, docker);
        let path = rt.vsock_path("vm-xyz");
        assert_eq!(path, PathBuf::from("/tmp/fc-test/vm-xyz_vsock.sock"));
    }

    #[tokio::test]
    async fn sandbox_exists_returns_false_for_unknown() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let rt = FirecrackerRuntime::new(FcConfig::default(), docker);
        let result = rt.sandbox_exists("iii-sbx-nonexistent").await.unwrap();
        assert!(!result);
    }

    #[tokio::test]
    async fn allocate_cid_increments() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let config = FcConfig {
            guest_cid_base: 200,
            ..Default::default()
        };
        let rt = FirecrackerRuntime::new(config, docker);
        let cid1 = rt.allocate_cid().await;
        let cid2 = rt.allocate_cid().await;
        assert_eq!(cid1, 200);
        assert_eq!(cid2, 201);
    }

    #[tokio::test]
    async fn create_and_remove_volume() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let tmp = std::env::temp_dir().join("fc_vol_test");
        let config = FcConfig {
            rootfs_cache_dir: tmp.clone(),
            ..Default::default()
        };
        let rt = FirecrackerRuntime::new(config, docker);

        rt.create_volume("test-vol", HashMap::new()).await.unwrap();
        assert!(tmp.join("volumes/test-vol").exists());

        rt.remove_volume("test-vol").await.unwrap();
        assert!(!tmp.join("volumes/test-vol").exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn network_operations_are_noop() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let rt = FirecrackerRuntime::new(FcConfig::default(), docker);

        let net_id = rt.create_network("test-net", "bridge", HashMap::new()).await.unwrap();
        assert!(net_id.starts_with("fc-net-"));

        rt.connect_network(&net_id, "vm1").await.unwrap();
        rt.disconnect_network(&net_id, "vm1", false).await.unwrap();
        rt.remove_network(&net_id).await.unwrap();
    }

    #[tokio::test]
    async fn resize_exec_is_noop() {
        let docker = Arc::new(Docker::connect_with_local_defaults().unwrap());
        let rt = FirecrackerRuntime::new(FcConfig::default(), docker);
        rt.resize_exec("exec-123", 80, 24).await.unwrap();
    }

    #[test]
    fn validate_vm_id_rejects_traversal() {
        assert!(FirecrackerRuntime::validate_vm_id("").is_err());
        assert!(FirecrackerRuntime::validate_vm_id("../etc/passwd").is_err());
        assert!(FirecrackerRuntime::validate_vm_id("foo/bar").is_err());
        assert!(FirecrackerRuntime::validate_vm_id("foo\\bar").is_err());
        assert!(FirecrackerRuntime::validate_vm_id("valid-id-123").is_ok());
        assert!(FirecrackerRuntime::validate_vm_id("abc_def.test").is_ok());
    }
}
