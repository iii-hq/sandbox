use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootSource {
    pub kernel_image_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boot_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initrd_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Drive {
    pub drive_id: String,
    pub path_on_host: String,
    pub is_root_device: bool,
    pub is_read_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limiter: Option<RateLimiter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineConfig {
    pub vcpu_count: u32,
    pub mem_size_mib: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_dirty_pages: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub iface_id: String,
    pub guest_mac: String,
    pub host_dev_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rx_rate_limiter: Option<RateLimiter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_rate_limiter: Option<RateLimiter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vsock {
    pub vsock_id: String,
    pub guest_cid: u32,
    pub uds_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimiter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bandwidth: Option<TokenBucket>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ops: Option<TokenBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBucket {
    pub size: u64,
    pub one_time_burst: u64,
    pub refill_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceActionInfo {
    pub action_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotCreateParams {
    pub snapshot_type: String,
    pub snapshot_path: String,
    pub mem_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotLoadParams {
    pub snapshot_path: String,
    pub mem_backend: MemBackend,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_diff_snapshots: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_vm: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemBackend {
    pub backend_type: String,
    pub backend_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInfo {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub vmm_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmState {
    pub state: String,
}

#[derive(Debug, Clone)]
pub struct FcConfig {
    pub fc_binary: PathBuf,
    pub kernel_path: PathBuf,
    pub agent_path: PathBuf,
    pub socket_dir: PathBuf,
    pub rootfs_cache_dir: PathBuf,
    pub snapshot_dir: PathBuf,
    pub default_vcpus: u32,
    pub default_mem_mib: u64,
    pub guest_cid_base: u32,
    pub tap_prefix: String,
    pub subnet_base: [u8; 2],
}

impl Default for FcConfig {
    fn default() -> Self {
        Self {
            fc_binary: PathBuf::from("/usr/bin/firecracker"),
            kernel_path: PathBuf::from("/opt/firecracker/vmlinux"),
            agent_path: PathBuf::from("/opt/firecracker/guest-agent"),
            socket_dir: PathBuf::from("/tmp/firecracker/sockets"),
            rootfs_cache_dir: PathBuf::from("/tmp/firecracker/rootfs"),
            snapshot_dir: PathBuf::from("/tmp/firecracker/snapshots"),
            default_vcpus: 2,
            default_mem_mib: 512,
            guest_cid_base: 100,
            tap_prefix: "fctap".to_string(),
            subnet_base: [172, 16],
        }
    }
}

#[derive(Debug, Clone)]
pub struct VmInstance {
    pub id: String,
    pub socket_path: PathBuf,
    pub rootfs_path: PathBuf,
    pub pid: Option<u32>,
    pub guest_cid: u32,
    pub tap_name: String,
    pub guest_ip: String,
    pub host_ip: String,
    pub state: VmLifecycleState,
    pub vcpus: u32,
    pub mem_mib: u64,
    pub labels: HashMap<String, String>,
    pub port_mappings: HashMap<String, Option<u16>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmLifecycleState {
    Creating,
    Running,
    Paused,
    Stopped,
}

impl std::fmt::Display for VmLifecycleState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Creating => write!(f, "creating"),
            Self::Running => write!(f, "running"),
            Self::Paused => write!(f, "paused"),
            Self::Stopped => write!(f, "stopped"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecRequest {
    pub command: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecResponse {
    pub exit_code: i64,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileWriteRequest {
    pub path: String,
    pub content: String,
    pub mode: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileReadRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileReadResponse {
    pub content: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentListDirRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentListDirEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_directory: bool,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSearchRequest {
    pub dir: String,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileInfoRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileInfoEntry {
    pub path: String,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatsResponse {
    pub cpu_percent: f64,
    pub memory_usage_bytes: u64,
    pub memory_total_bytes: u64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
    pub pids: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProcessEntry {
    pub pid: u64,
    pub user: String,
    pub command: String,
    pub cpu: f64,
    pub memory: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_source_serialization() {
        let bs = BootSource {
            kernel_image_path: "/opt/vmlinux".to_string(),
            boot_args: Some("console=ttyS0".to_string()),
            initrd_path: None,
        };
        let json = serde_json::to_value(&bs).unwrap();
        assert_eq!(json["kernel_image_path"], "/opt/vmlinux");
        assert_eq!(json["boot_args"], "console=ttyS0");
        assert!(json.get("initrd_path").is_none());
    }

    #[test]
    fn drive_serialization() {
        let d = Drive {
            drive_id: "rootfs".to_string(),
            path_on_host: "/tmp/rootfs.ext4".to_string(),
            is_root_device: true,
            is_read_only: false,
            rate_limiter: None,
        };
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["drive_id"], "rootfs");
        assert_eq!(json["is_root_device"], true);
    }

    #[test]
    fn machine_config_serialization() {
        let mc = MachineConfig {
            vcpu_count: 4,
            mem_size_mib: 1024,
            smt: Some(false),
            track_dirty_pages: Some(true),
        };
        let json = serde_json::to_value(&mc).unwrap();
        assert_eq!(json["vcpu_count"], 4);
        assert_eq!(json["mem_size_mib"], 1024);
        assert_eq!(json["track_dirty_pages"], true);
    }

    #[test]
    fn network_interface_serialization() {
        let ni = NetworkInterface {
            iface_id: "eth0".to_string(),
            guest_mac: "AA:FC:00:00:00:01".to_string(),
            host_dev_name: "fctap0".to_string(),
            rx_rate_limiter: None,
            tx_rate_limiter: None,
        };
        let json = serde_json::to_value(&ni).unwrap();
        assert_eq!(json["iface_id"], "eth0");
        assert_eq!(json["host_dev_name"], "fctap0");
    }

    #[test]
    fn vsock_serialization() {
        let vs = Vsock {
            vsock_id: "vsock0".to_string(),
            guest_cid: 3,
            uds_path: "/tmp/vsock.sock".to_string(),
        };
        let json = serde_json::to_value(&vs).unwrap();
        assert_eq!(json["guest_cid"], 3);
    }

    #[test]
    fn snapshot_create_params() {
        let sp = SnapshotCreateParams {
            snapshot_type: "Full".to_string(),
            snapshot_path: "/tmp/snap.bin".to_string(),
            mem_file_path: "/tmp/snap.mem".to_string(),
        };
        let json = serde_json::to_value(&sp).unwrap();
        assert_eq!(json["snapshot_type"], "Full");
    }

    #[test]
    fn vm_lifecycle_state_display() {
        assert_eq!(VmLifecycleState::Creating.to_string(), "creating");
        assert_eq!(VmLifecycleState::Running.to_string(), "running");
        assert_eq!(VmLifecycleState::Paused.to_string(), "paused");
        assert_eq!(VmLifecycleState::Stopped.to_string(), "stopped");
    }

    #[test]
    fn fc_config_default() {
        let cfg = FcConfig::default();
        assert_eq!(cfg.default_vcpus, 2);
        assert_eq!(cfg.default_mem_mib, 512);
        assert_eq!(cfg.guest_cid_base, 100);
    }

    #[test]
    fn agent_exec_request_serialization() {
        let req = AgentExecRequest {
            command: vec!["echo".into(), "hello".into()],
            timeout_ms: Some(5000),
            workdir: None,
            env: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["command"][0], "echo");
        assert_eq!(json["timeout_ms"], 5000);
    }

    #[test]
    fn agent_exec_response_deserialization() {
        let data = serde_json::json!({
            "exit_code": 0,
            "stdout": "hello\n",
            "stderr": "",
            "duration_ms": 42
        });
        let resp: AgentExecResponse = serde_json::from_value(data).unwrap();
        assert_eq!(resp.exit_code, 0);
        assert_eq!(resp.stdout, "hello\n");
        assert_eq!(resp.duration_ms, 42);
    }

    #[test]
    fn agent_stats_response_deserialization() {
        let data = serde_json::json!({
            "cpu_percent": 15.5,
            "memory_usage_bytes": 268435456_u64,
            "memory_total_bytes": 536870912_u64,
            "network_rx_bytes": 1024,
            "network_tx_bytes": 2048,
            "pids": 12
        });
        let stats: AgentStatsResponse = serde_json::from_value(data).unwrap();
        assert_eq!(stats.cpu_percent, 15.5);
        assert_eq!(stats.pids, 12);
    }

    #[test]
    fn instance_action_info_serialization() {
        let action = InstanceActionInfo {
            action_type: "InstanceStart".to_string(),
        };
        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["action_type"], "InstanceStart");
    }

    #[test]
    fn snapshot_load_params_serialization() {
        let params = SnapshotLoadParams {
            snapshot_path: "/tmp/snap.bin".into(),
            mem_backend: MemBackend {
                backend_type: "File".into(),
                backend_path: "/tmp/snap.mem".into(),
            },
            enable_diff_snapshots: None,
            resume_vm: Some(true),
        };
        let json = serde_json::to_value(&params).unwrap();
        assert_eq!(json["mem_backend"]["backend_type"], "File");
        assert_eq!(json["resume_vm"], true);
    }
}
