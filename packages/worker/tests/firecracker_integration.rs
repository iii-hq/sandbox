#![cfg(feature = "firecracker")]

mod common;

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use common::TestContext;

// ---------------------------------------------------------------------------
// Inline replicas of internal types for integration testing.
// The worker crate is a binary (no lib.rs), so we cannot import its modules
// directly. These structs mirror the source-of-truth definitions in
// `src/runtime/fc_types.rs` and `src/runtime/fc_network.rs`.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct SubnetInfo {
    host_ip: String,
    guest_ip: String,
    netmask: String,
    subnet_id: u8,
}

struct SubnetAllocator {
    base: [u8; 2],
    allocated: HashMap<String, u8>,
    free_list: Vec<u8>,
    next_subnet: u8,
}

impl SubnetAllocator {
    fn new(base: [u8; 2]) -> Self {
        Self {
            base,
            allocated: HashMap::new(),
            free_list: Vec::new(),
            next_subnet: 1,
        }
    }

    fn allocate(&mut self, vm_id: &str) -> Result<SubnetInfo, String> {
        if let Some(&existing) = self.allocated.get(vm_id) {
            return Ok(self.build_info(existing));
        }

        let subnet_id = if let Some(recycled) = self.free_list.pop() {
            recycled
        } else if self.next_subnet < 254 {
            let id = self.next_subnet;
            self.next_subnet += 1;
            id
        } else {
            return Err("No available subnets".to_string());
        };

        self.allocated.insert(vm_id.to_string(), subnet_id);
        Ok(self.build_info(subnet_id))
    }

    fn release(&mut self, vm_id: &str) {
        if let Some(subnet_id) = self.allocated.remove(vm_id) {
            self.free_list.push(subnet_id);
        }
    }

    fn get(&self, vm_id: &str) -> Option<SubnetInfo> {
        self.allocated.get(vm_id).map(|&id| self.build_info(id))
    }

    fn build_info(&self, subnet_id: u8) -> SubnetInfo {
        SubnetInfo {
            host_ip: format!("{}.{}.{}.1", self.base[0], self.base[1], subnet_id),
            guest_ip: format!("{}.{}.{}.2", self.base[0], self.base[1], subnet_id),
            netmask: "255.255.255.252".to_string(),
            subnet_id,
        }
    }
}

fn generate_mac(vm_index: u8) -> String {
    format!("AA:FC:00:00:00:{:02X}", vm_index)
}

fn safe_image_name(image: &str) -> String {
    image.replace(['/', ':', '.'], "_")
}

// --- FC API types (mirrors fc_types.rs) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BootSource {
    kernel_image_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    boot_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    initrd_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Drive {
    drive_id: String,
    path_on_host: String,
    is_root_device: bool,
    is_read_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    rate_limiter: Option<RateLimiter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MachineConfig {
    vcpu_count: u32,
    mem_size_mib: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    smt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    track_dirty_pages: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NetworkInterface {
    iface_id: String,
    guest_mac: String,
    host_dev_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    rx_rate_limiter: Option<RateLimiter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tx_rate_limiter: Option<RateLimiter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Vsock {
    vsock_id: String,
    guest_cid: u32,
    uds_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RateLimiter {
    #[serde(skip_serializing_if = "Option::is_none")]
    bandwidth: Option<TokenBucket>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ops: Option<TokenBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokenBucket {
    size: u64,
    one_time_burst: u64,
    refill_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstanceActionInfo {
    action_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotCreateParams {
    snapshot_type: String,
    snapshot_path: String,
    mem_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotLoadParams {
    snapshot_path: String,
    mem_backend: MemBackend,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_diff_snapshots: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resume_vm: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemBackend {
    backend_type: String,
    backend_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstanceInfo {
    #[serde(default)]
    id: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    vmm_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VmState {
    state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentExecRequest {
    command: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentExecResponse {
    exit_code: i64,
    stdout: String,
    stderr: String,
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentStatsResponse {
    cpu_percent: f64,
    memory_usage_bytes: u64,
    memory_total_bytes: u64,
    network_rx_bytes: u64,
    network_tx_bytes: u64,
    pids: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentProcessEntry {
    pid: u64,
    user: String,
    command: String,
    cpu: f64,
    memory: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentTerminalCreateRequest {
    cols: u16,
    rows: u16,
    shell: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentTerminalCreateResponse {
    session_id: String,
}

// =========================================================================
//  Section 1: Unit-level integration tests (no real Firecracker needed)
// =========================================================================

#[cfg(test)]
mod subnet_allocator_tests {
    use super::*;

    #[test]
    fn full_lifecycle_allocate_use_release_reallocate() {
        let mut alloc = SubnetAllocator::new([172, 16]);

        let s1 = alloc.allocate("vm-alpha").unwrap();
        assert_eq!(s1.subnet_id, 1);
        assert_eq!(s1.host_ip, "172.16.1.1");
        assert_eq!(s1.guest_ip, "172.16.1.2");
        assert_eq!(s1.netmask, "255.255.255.252");

        let s2 = alloc.allocate("vm-beta").unwrap();
        assert_eq!(s2.subnet_id, 2);

        let s3 = alloc.allocate("vm-gamma").unwrap();
        assert_eq!(s3.subnet_id, 3);

        assert!(alloc.get("vm-alpha").is_some());
        assert!(alloc.get("vm-beta").is_some());
        assert!(alloc.get("vm-gamma").is_some());
        assert!(alloc.get("vm-nonexistent").is_none());

        alloc.release("vm-beta");
        assert!(alloc.get("vm-beta").is_none());

        let s4 = alloc.allocate("vm-delta").unwrap();
        assert_eq!(s4.subnet_id, 2, "released subnet 2 should be recycled");

        let s5 = alloc.allocate("vm-epsilon").unwrap();
        assert_eq!(s5.subnet_id, 4, "next fresh subnet should be 4");
    }

    #[test]
    fn idempotent_allocation() {
        let mut alloc = SubnetAllocator::new([10, 0]);

        let first = alloc.allocate("vm-1").unwrap();
        let second = alloc.allocate("vm-1").unwrap();

        assert_eq!(first.subnet_id, second.subnet_id);
        assert_eq!(first.host_ip, second.host_ip);
        assert_eq!(first.guest_ip, second.guest_ip);

        assert_eq!(alloc.next_subnet, 2, "should not consume extra subnet IDs");
    }

    #[test]
    fn exhaustion_at_254() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        alloc.next_subnet = 254;

        let result = alloc.allocate("vm-overflow");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No available subnets"));
    }

    #[test]
    fn exhaustion_then_release_allows_allocation() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        alloc.next_subnet = 254;

        assert!(alloc.allocate("vm-new").is_err());

        alloc.allocated.insert("vm-old".to_string(), 100);
        alloc.release("vm-old");

        let info = alloc.allocate("vm-new").unwrap();
        assert_eq!(info.subnet_id, 100, "should reuse freed subnet");
    }

    #[test]
    fn release_nonexistent_is_noop() {
        let mut alloc = SubnetAllocator::new([10, 0]);
        alloc.release("does-not-exist");
        assert!(alloc.free_list.is_empty());
    }

    #[test]
    fn many_allocations_are_sequential() {
        let mut alloc = SubnetAllocator::new([192, 168]);
        let mut seen = HashSet::new();

        for i in 0..100 {
            let info = alloc.allocate(&format!("vm-{i}")).unwrap();
            assert!(
                seen.insert(info.subnet_id),
                "subnet_id {} was allocated twice",
                info.subnet_id
            );
        }

        assert_eq!(seen.len(), 100);
    }

    #[test]
    fn different_bases_produce_different_ips() {
        let mut alloc_a = SubnetAllocator::new([10, 0]);
        let mut alloc_b = SubnetAllocator::new([172, 16]);

        let a = alloc_a.allocate("vm-1").unwrap();
        let b = alloc_b.allocate("vm-1").unwrap();

        assert_ne!(a.host_ip, b.host_ip);
        assert_ne!(a.guest_ip, b.guest_ip);
        assert_eq!(a.subnet_id, b.subnet_id);
    }

    #[test]
    fn release_and_reallocate_cycle() {
        let mut alloc = SubnetAllocator::new([172, 16]);

        for cycle in 0..5 {
            let info = alloc.allocate("cycling-vm").unwrap();
            let expected_id = if cycle == 0 { 1 } else { 1 };
            assert_eq!(info.subnet_id, expected_id, "cycle {cycle}");
            alloc.release("cycling-vm");
        }
    }
}

#[cfg(test)]
mod mac_address_tests {
    use super::*;

    #[test]
    fn format_is_correct() {
        assert_eq!(generate_mac(0), "AA:FC:00:00:00:00");
        assert_eq!(generate_mac(1), "AA:FC:00:00:00:01");
        assert_eq!(generate_mac(16), "AA:FC:00:00:00:10");
        assert_eq!(generate_mac(255), "AA:FC:00:00:00:FF");
    }

    #[test]
    fn uniqueness_across_all_256_values() {
        let mut seen = HashSet::new();
        for i in 0..=255u8 {
            let mac = generate_mac(i);
            assert!(seen.insert(mac.clone()), "duplicate MAC at index {i}: {mac}");
        }
        assert_eq!(seen.len(), 256);
    }

    #[test]
    fn has_local_admin_bit() {
        for i in [0u8, 1, 127, 255] {
            let mac = generate_mac(i);
            let first_octet = u8::from_str_radix(&mac[..2], 16).unwrap();
            assert!(
                first_octet & 0x02 != 0,
                "MAC {} should have the locally-administered bit set",
                mac
            );
        }
    }

    #[test]
    fn is_unicast() {
        for i in [0u8, 1, 127, 255] {
            let mac = generate_mac(i);
            let first_octet = u8::from_str_radix(&mac[..2], 16).unwrap();
            assert!(
                first_octet & 0x01 == 0,
                "MAC {} should be unicast (LSB of first octet = 0)",
                mac
            );
        }
    }

    #[test]
    fn colon_separated_six_octets() {
        for i in [0u8, 42, 128, 255] {
            let mac = generate_mac(i);
            let parts: Vec<&str> = mac.split(':').collect();
            assert_eq!(parts.len(), 6, "MAC should have 6 colon-separated octets: {mac}");
            for part in &parts {
                assert_eq!(part.len(), 2, "each octet should be 2 hex chars: {mac}");
                assert!(
                    u8::from_str_radix(part, 16).is_ok(),
                    "each octet should be valid hex: {mac}"
                );
            }
        }
    }
}

#[cfg(test)]
mod rootfs_path_tests {
    use super::*;

    #[test]
    fn basic_image_names() {
        assert_eq!(safe_image_name("alpine:3.19"), "alpine_3_19");
        assert_eq!(safe_image_name("ubuntu:22.04"), "ubuntu_22_04");
        assert_eq!(safe_image_name("python:3.12-slim"), "python_3_12-slim");
    }

    #[test]
    fn fully_qualified_registry_names() {
        assert_eq!(
            safe_image_name("docker.io/library/node:20"),
            "docker_io_library_node_20"
        );
        assert_eq!(
            safe_image_name("ghcr.io/org/image:v1.2.3"),
            "ghcr_io_org_image_v1_2_3"
        );
        assert_eq!(
            safe_image_name("registry.example.com:5000/myapp:latest"),
            "registry_example_com_5000_myapp_latest"
        );
    }

    #[test]
    fn no_tag() {
        assert_eq!(safe_image_name("alpine"), "alpine");
        assert_eq!(safe_image_name("library/nginx"), "library_nginx");
    }

    #[test]
    fn digest_references() {
        let name = safe_image_name("alpine@sha256:abc123");
        assert!(!name.contains('/'), "/ should not appear in safe name");
        assert!(!name.contains(':'), ": should not appear in safe name");
        assert!(name.contains('@'), "@ is preserved by safe_image_name (not in replacement set)");
        assert_eq!(name, "alpine@sha256_abc123");
    }

    #[test]
    fn result_is_filesystem_safe() {
        let names = [
            "alpine:3.19",
            "docker.io/library/node:20-slim",
            "ghcr.io/org/repo:v1.0.0",
            "my.registry.com:5000/deep/path/image:tag",
        ];
        for img in names {
            let safe = safe_image_name(img);
            assert!(
                !safe.contains('/'),
                "safe name should not contain '/': {safe}"
            );
            assert!(
                !safe.contains(':'),
                "safe name should not contain ':': {safe}"
            );
        }
    }

    #[test]
    fn rootfs_path_calculation() {
        let cache_dir = PathBuf::from("/tmp/firecracker/rootfs");
        let image = "python:3.12-slim";
        let safe = safe_image_name(image);
        let rootfs_path = cache_dir.join(format!("{safe}.ext4"));
        assert_eq!(
            rootfs_path,
            PathBuf::from("/tmp/firecracker/rootfs/python_3_12-slim.ext4")
        );
    }
}

#[cfg(test)]
mod fc_types_serde_tests {
    use super::*;

    #[test]
    fn boot_source_round_trip() {
        let bs = BootSource {
            kernel_image_path: "/opt/vmlinux".to_string(),
            boot_args: Some("console=ttyS0 reboot=k panic=1".to_string()),
            initrd_path: None,
        };
        let json_str = serde_json::to_string(&bs).unwrap();
        let deserialized: BootSource = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.kernel_image_path, bs.kernel_image_path);
        assert_eq!(deserialized.boot_args, bs.boot_args);
        assert_eq!(deserialized.initrd_path, bs.initrd_path);
    }

    #[test]
    fn boot_source_skip_none_fields() {
        let bs = BootSource {
            kernel_image_path: "/opt/vmlinux".to_string(),
            boot_args: None,
            initrd_path: None,
        };
        let json_val = serde_json::to_value(&bs).unwrap();
        assert!(json_val.get("boot_args").is_none());
        assert!(json_val.get("initrd_path").is_none());
    }

    #[test]
    fn drive_round_trip() {
        let d = Drive {
            drive_id: "rootfs".to_string(),
            path_on_host: "/tmp/rootfs.ext4".to_string(),
            is_root_device: true,
            is_read_only: false,
            rate_limiter: Some(RateLimiter {
                bandwidth: Some(TokenBucket {
                    size: 1048576,
                    one_time_burst: 2097152,
                    refill_time: 1000,
                }),
                ops: None,
            }),
        };
        let json_str = serde_json::to_string(&d).unwrap();
        let deserialized: Drive = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.drive_id, "rootfs");
        assert_eq!(deserialized.is_root_device, true);
        assert!(deserialized.rate_limiter.is_some());
        assert_eq!(deserialized.rate_limiter.unwrap().bandwidth.unwrap().size, 1048576);
    }

    #[test]
    fn machine_config_round_trip() {
        let mc = MachineConfig {
            vcpu_count: 4,
            mem_size_mib: 2048,
            smt: Some(false),
            track_dirty_pages: Some(true),
        };
        let json_str = serde_json::to_string(&mc).unwrap();
        let deserialized: MachineConfig = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.vcpu_count, 4);
        assert_eq!(deserialized.mem_size_mib, 2048);
        assert_eq!(deserialized.smt, Some(false));
        assert_eq!(deserialized.track_dirty_pages, Some(true));
    }

    #[test]
    fn network_interface_round_trip() {
        let ni = NetworkInterface {
            iface_id: "eth0".to_string(),
            guest_mac: "AA:FC:00:00:00:01".to_string(),
            host_dev_name: "fctap1".to_string(),
            rx_rate_limiter: None,
            tx_rate_limiter: None,
        };
        let json_str = serde_json::to_string(&ni).unwrap();
        let deserialized: NetworkInterface = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.iface_id, "eth0");
        assert_eq!(deserialized.guest_mac, "AA:FC:00:00:00:01");
        assert_eq!(deserialized.host_dev_name, "fctap1");
    }

    #[test]
    fn vsock_round_trip() {
        let vs = Vsock {
            vsock_id: "vsock0".to_string(),
            guest_cid: 42,
            uds_path: "/tmp/vsock.sock".to_string(),
        };
        let json_str = serde_json::to_string(&vs).unwrap();
        let deserialized: Vsock = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.vsock_id, "vsock0");
        assert_eq!(deserialized.guest_cid, 42);
        assert_eq!(deserialized.uds_path, "/tmp/vsock.sock");
    }

    #[test]
    fn instance_action_info_round_trip() {
        let action = InstanceActionInfo {
            action_type: "InstanceStart".to_string(),
        };
        let json_str = serde_json::to_string(&action).unwrap();
        let deserialized: InstanceActionInfo = serde_json::from_str(&json_str).unwrap();
        assert_eq!(deserialized.action_type, "InstanceStart");
    }

    #[test]
    fn snapshot_create_params_round_trip() {
        let sp = SnapshotCreateParams {
            snapshot_type: "Full".to_string(),
            snapshot_path: "/tmp/snap.bin".to_string(),
            mem_file_path: "/tmp/snap.mem".to_string(),
        };
        let json_str = serde_json::to_string(&sp).unwrap();
        let deserialized: SnapshotCreateParams = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.snapshot_type, "Full");
        assert_eq!(deserialized.snapshot_path, "/tmp/snap.bin");
        assert_eq!(deserialized.mem_file_path, "/tmp/snap.mem");
    }

    #[test]
    fn snapshot_load_params_round_trip() {
        let params = SnapshotLoadParams {
            snapshot_path: "/tmp/snap.bin".to_string(),
            mem_backend: MemBackend {
                backend_type: "File".to_string(),
                backend_path: "/tmp/snap.mem".to_string(),
            },
            enable_diff_snapshots: Some(true),
            resume_vm: Some(true),
        };
        let json_str = serde_json::to_string(&params).unwrap();
        let deserialized: SnapshotLoadParams = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.snapshot_path, "/tmp/snap.bin");
        assert_eq!(deserialized.mem_backend.backend_type, "File");
        assert_eq!(deserialized.enable_diff_snapshots, Some(true));
        assert_eq!(deserialized.resume_vm, Some(true));
    }

    #[test]
    fn snapshot_load_params_skip_none() {
        let params = SnapshotLoadParams {
            snapshot_path: "/tmp/snap.bin".to_string(),
            mem_backend: MemBackend {
                backend_type: "File".to_string(),
                backend_path: "/tmp/snap.mem".to_string(),
            },
            enable_diff_snapshots: None,
            resume_vm: None,
        };
        let json_val = serde_json::to_value(&params).unwrap();
        assert!(json_val.get("enable_diff_snapshots").is_none());
        assert!(json_val.get("resume_vm").is_none());
    }

    #[test]
    fn instance_info_round_trip() {
        let info_json = json!({
            "id": "fc-vm-1",
            "state": "Running",
            "vmm_version": "1.5.0"
        });
        let info: InstanceInfo = serde_json::from_value(info_json.clone()).unwrap();
        assert_eq!(info.id, "fc-vm-1");
        assert_eq!(info.state, "Running");
        assert_eq!(info.vmm_version, "1.5.0");

        let back = serde_json::to_value(&info).unwrap();
        assert_eq!(back["id"], "fc-vm-1");
    }

    #[test]
    fn instance_info_with_defaults() {
        let info: InstanceInfo = serde_json::from_value(json!({})).unwrap();
        assert_eq!(info.id, "");
        assert_eq!(info.state, "");
        assert_eq!(info.vmm_version, "");
    }

    #[test]
    fn vm_state_round_trip() {
        for state_str in ["Paused", "Resumed"] {
            let vs = VmState {
                state: state_str.to_string(),
            };
            let json_str = serde_json::to_string(&vs).unwrap();
            let deserialized: VmState = serde_json::from_str(&json_str).unwrap();
            assert_eq!(deserialized.state, state_str);
        }
    }

    #[test]
    fn rate_limiter_full_round_trip() {
        let rl = RateLimiter {
            bandwidth: Some(TokenBucket {
                size: 1_000_000,
                one_time_burst: 5_000_000,
                refill_time: 500,
            }),
            ops: Some(TokenBucket {
                size: 100,
                one_time_burst: 200,
                refill_time: 1000,
            }),
        };
        let json_str = serde_json::to_string(&rl).unwrap();
        let deserialized: RateLimiter = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.bandwidth.as_ref().unwrap().size, 1_000_000);
        assert_eq!(deserialized.ops.as_ref().unwrap().refill_time, 1000);
    }

    #[test]
    fn agent_exec_request_round_trip() {
        let req = AgentExecRequest {
            command: vec!["ls".into(), "-la".into(), "/tmp".into()],
            timeout_ms: Some(30000),
            workdir: Some("/home".to_string()),
            env: Some(HashMap::from([("KEY".to_string(), "VALUE".to_string())])),
        };
        let json_str = serde_json::to_string(&req).unwrap();
        let deserialized: AgentExecRequest = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.command, vec!["ls", "-la", "/tmp"]);
        assert_eq!(deserialized.timeout_ms, Some(30000));
        assert_eq!(deserialized.workdir.as_deref(), Some("/home"));
        assert_eq!(
            deserialized.env.as_ref().unwrap().get("KEY").unwrap(),
            "VALUE"
        );
    }

    #[test]
    fn agent_exec_request_skip_none() {
        let req = AgentExecRequest {
            command: vec!["echo".into()],
            timeout_ms: None,
            workdir: None,
            env: None,
        };
        let json_val = serde_json::to_value(&req).unwrap();
        assert!(json_val.get("timeout_ms").is_none());
        assert!(json_val.get("workdir").is_none());
        assert!(json_val.get("env").is_none());
    }

    #[test]
    fn agent_exec_response_round_trip() {
        let data = json!({
            "exit_code": 0,
            "stdout": "hello world\n",
            "stderr": "",
            "duration_ms": 42
        });
        let resp: AgentExecResponse = serde_json::from_value(data).unwrap();
        assert_eq!(resp.exit_code, 0);
        assert_eq!(resp.stdout, "hello world\n");
        assert_eq!(resp.stderr, "");
        assert_eq!(resp.duration_ms, 42);

        let back = serde_json::to_value(&resp).unwrap();
        assert_eq!(back["exit_code"], 0);
    }

    #[test]
    fn agent_exec_response_negative_exit_code() {
        let data = json!({
            "exit_code": -1,
            "stdout": "",
            "stderr": "killed by signal",
            "duration_ms": 5000
        });
        let resp: AgentExecResponse = serde_json::from_value(data).unwrap();
        assert_eq!(resp.exit_code, -1);
        assert_eq!(resp.stderr, "killed by signal");
    }

    #[test]
    fn agent_stats_response_round_trip() {
        let data = json!({
            "cpu_percent": 25.5,
            "memory_usage_bytes": 536870912_u64,
            "memory_total_bytes": 1073741824_u64,
            "network_rx_bytes": 4096,
            "network_tx_bytes": 8192,
            "pids": 24
        });
        let stats: AgentStatsResponse = serde_json::from_value(data).unwrap();
        assert_eq!(stats.cpu_percent, 25.5);
        assert_eq!(stats.memory_usage_bytes, 536870912);
        assert_eq!(stats.pids, 24);

        let back = serde_json::to_value(&stats).unwrap();
        assert_eq!(back["network_rx_bytes"], 4096);
    }

    #[test]
    fn agent_process_entry_round_trip() {
        let data = json!({
            "pid": 1,
            "user": "root",
            "command": "/sbin/init",
            "cpu": 0.1,
            "memory": 2.5
        });
        let proc: AgentProcessEntry = serde_json::from_value(data).unwrap();
        assert_eq!(proc.pid, 1);
        assert_eq!(proc.user, "root");
        assert_eq!(proc.command, "/sbin/init");

        let back = serde_json::to_value(&proc).unwrap();
        assert_eq!(back["pid"], 1);
    }

    #[test]
    fn terminal_create_request_round_trip() {
        let req = AgentTerminalCreateRequest {
            cols: 80,
            rows: 24,
            shell: "/bin/bash".to_string(),
        };
        let json_str = serde_json::to_string(&req).unwrap();
        let deserialized: AgentTerminalCreateRequest = serde_json::from_str(&json_str).unwrap();

        assert_eq!(deserialized.cols, 80);
        assert_eq!(deserialized.rows, 24);
        assert_eq!(deserialized.shell, "/bin/bash");
    }

    #[test]
    fn terminal_create_response_round_trip() {
        let resp = AgentTerminalCreateResponse {
            session_id: "sess-abc123".to_string(),
        };
        let json_str = serde_json::to_string(&resp).unwrap();
        let deserialized: AgentTerminalCreateResponse = serde_json::from_str(&json_str).unwrap();
        assert_eq!(deserialized.session_id, "sess-abc123");
    }

    #[test]
    fn drive_without_rate_limiter_skips_field() {
        let d = Drive {
            drive_id: "data".to_string(),
            path_on_host: "/tmp/data.ext4".to_string(),
            is_root_device: false,
            is_read_only: true,
            rate_limiter: None,
        };
        let json_val = serde_json::to_value(&d).unwrap();
        assert!(json_val.get("rate_limiter").is_none());
        assert_eq!(json_val["is_read_only"], true);
    }

    #[test]
    fn network_interface_without_limiters_skips_fields() {
        let ni = NetworkInterface {
            iface_id: "eth0".to_string(),
            guest_mac: "AA:FC:00:00:00:01".to_string(),
            host_dev_name: "fctap1".to_string(),
            rx_rate_limiter: None,
            tx_rate_limiter: None,
        };
        let json_val = serde_json::to_value(&ni).unwrap();
        assert!(json_val.get("rx_rate_limiter").is_none());
        assert!(json_val.get("tx_rate_limiter").is_none());
    }
}

#[cfg(test)]
mod network_info_tests {
    use super::*;

    #[test]
    fn ip_format_is_valid_ipv4() {
        let mut alloc = SubnetAllocator::new([10, 0]);
        let info = alloc.allocate("vm-1").unwrap();

        let host_parts: Vec<u8> = info
            .host_ip
            .split('.')
            .map(|p| p.parse().unwrap())
            .collect();
        assert_eq!(host_parts.len(), 4);
        assert_eq!(host_parts[0], 10);
        assert_eq!(host_parts[1], 0);
        assert_eq!(host_parts[3], 1);

        let guest_parts: Vec<u8> = info
            .guest_ip
            .split('.')
            .map(|p| p.parse().unwrap())
            .collect();
        assert_eq!(guest_parts.len(), 4);
        assert_eq!(guest_parts[3], 2);
    }

    #[test]
    fn netmask_is_slash_30() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        let info = alloc.allocate("vm-1").unwrap();
        assert_eq!(info.netmask, "255.255.255.252");
    }

    #[test]
    fn host_and_guest_ips_differ_only_in_last_octet() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        for i in 0..10 {
            let info = alloc.allocate(&format!("vm-{i}")).unwrap();

            let host_parts: Vec<&str> = info.host_ip.split('.').collect();
            let guest_parts: Vec<&str> = info.guest_ip.split('.').collect();

            assert_eq!(host_parts[0], guest_parts[0]);
            assert_eq!(host_parts[1], guest_parts[1]);
            assert_eq!(host_parts[2], guest_parts[2]);
            assert_eq!(host_parts[3], "1");
            assert_eq!(guest_parts[3], "2");
        }
    }

    #[test]
    fn boot_args_ip_formatting() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        let subnet = alloc.allocate("vm-1").unwrap();

        let boot_args = format!(
            "console=ttyS0 reboot=k panic=1 pci=off \
             ip={guest_ip}::{host_ip}:{netmask}::eth0:off",
            guest_ip = subnet.guest_ip,
            host_ip = subnet.host_ip,
            netmask = subnet.netmask,
        );

        assert!(boot_args.contains("ip=172.16.1.2::172.16.1.1:255.255.255.252::eth0:off"));
    }

    #[test]
    fn tap_name_format() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        let info = alloc.allocate("vm-1").unwrap();
        let tap_prefix = "fctap";
        let tap_name = format!("{}{}", tap_prefix, info.subnet_id);
        assert_eq!(tap_name, "fctap1");
    }
}

// =========================================================================
//  Section 2: Conditional integration tests (need real Firecracker binary)
// =========================================================================

#[cfg(test)]
mod vm_integration_tests {
    use super::*;
    use common::skip_unless_fc;

    fn unique_vm_id() -> String {
        format!("fc-test-{}", uuid::Uuid::new_v4().to_string().get(..8).unwrap_or("rand"))
    }

    #[tokio::test]
    #[ignore]
    async fn test_vm_lifecycle() {
        skip_unless_fc!();

        let ctx = TestContext::new();
        let vm_id = unique_vm_id();

        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let (status, body) = ctx
                .api(
                    "POST",
                    "/sandboxes",
                    Some(json!({
                        "image": "alpine:3.19",
                        "timeout": 120,
                        "name": vm_id,
                        "backend": "firecracker"
                    })),
                )
                .await;
            assert!(
                status == 200 || status == 201,
                "create failed: status={status}, body={body}"
            );
            let inner = body.get("body").unwrap_or(&body);
            let id = inner["id"]
                .as_str()
                .expect("response must contain id")
                .to_string();

            let (get_status, get_body) = ctx.api("GET", &format!("/sandboxes/{id}"), None).await;
            assert_eq!(get_status, 200);
            let get_inner = get_body.get("body").unwrap_or(&get_body);
            let sandbox_status = get_inner["status"].as_str().unwrap_or("unknown");
            assert_eq!(sandbox_status, "running", "sandbox should be running after create");

            let (exec_status, exec_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "echo alive"})),
                )
                .await;
            assert_eq!(exec_status, 200, "exec should succeed on running VM");
            let exec_inner = exec_body.get("body").unwrap_or(&exec_body);
            assert_eq!(exec_inner["exitCode"].as_i64(), Some(0));
            let stdout = exec_inner["stdout"].as_str().unwrap_or("");
            assert!(stdout.contains("alive"), "stdout should contain 'alive'");

            let (stop_status, _) = ctx
                .api("POST", &format!("/sandboxes/{id}/stop"), None)
                .await;
            assert!(stop_status == 200 || stop_status == 204, "stop should succeed");

            let (del_status, _) = ctx
                .api("DELETE", &format!("/sandboxes/{id}"), None)
                .await;
            assert_eq!(del_status, 200, "delete should succeed");

            let (check_status, _) = ctx.api("GET", &format!("/sandboxes/{id}"), None).await;
            assert!(
                check_status == 404 || check_status == 200,
                "sandbox should be gone or marked as stopped"
            );
        })
        .await;

        assert!(result.is_ok(), "test_vm_lifecycle timed out after 60s");
    }

    #[tokio::test]
    #[ignore]
    async fn test_vm_exec() {
        skip_unless_fc!();

        let ctx = TestContext::new();
        let vm_id = unique_vm_id();

        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let (_, body) = ctx
                .api(
                    "POST",
                    "/sandboxes",
                    Some(json!({
                        "image": "alpine:3.19",
                        "timeout": 120,
                        "name": vm_id,
                        "backend": "firecracker"
                    })),
                )
                .await;
            let inner = body.get("body").unwrap_or(&body);
            let id = inner["id"].as_str().unwrap().to_string();

            let (_, stdout_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "echo hello-world"})),
                )
                .await;
            let stdout_inner = stdout_body.get("body").unwrap_or(&stdout_body);
            assert_eq!(stdout_inner["exitCode"].as_i64(), Some(0));
            assert!(stdout_inner["stdout"].as_str().unwrap_or("").contains("hello-world"));

            let (_, stderr_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "echo err-output >&2"})),
                )
                .await;
            let stderr_inner = stderr_body.get("body").unwrap_or(&stderr_body);
            assert!(stderr_inner["stderr"].as_str().unwrap_or("").contains("err-output"));

            let (_, exit_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "exit 42"})),
                )
                .await;
            let exit_inner = exit_body.get("body").unwrap_or(&exit_body);
            assert_eq!(exit_inner["exitCode"].as_i64(), Some(42));

            let (_, multi_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "uname -s"})),
                )
                .await;
            let multi_inner = multi_body.get("body").unwrap_or(&multi_body);
            assert_eq!(multi_inner["exitCode"].as_i64(), Some(0));
            assert!(multi_inner["stdout"].as_str().unwrap_or("").contains("Linux"));

            ctx.cleanup(&id).await;
        })
        .await;

        assert!(result.is_ok(), "test_vm_exec timed out after 60s");
    }

    #[tokio::test]
    #[ignore]
    async fn test_vm_file_ops() {
        skip_unless_fc!();

        let ctx = TestContext::new();
        let vm_id = unique_vm_id();

        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let (_, body) = ctx
                .api(
                    "POST",
                    "/sandboxes",
                    Some(json!({
                        "image": "alpine:3.19",
                        "timeout": 120,
                        "name": vm_id,
                        "backend": "firecracker"
                    })),
                )
                .await;
            let inner = body.get("body").unwrap_or(&body);
            let id = inner["id"].as_str().unwrap().to_string();

            let test_content = "Hello from Firecracker integration test!\nLine 2\n";
            let test_path = "/tmp/fc-test-file.txt";

            let (write_status, _) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/files/write"),
                    Some(json!({
                        "path": test_path,
                        "content": test_content
                    })),
                )
                .await;
            assert!(write_status == 200 || write_status == 201, "write should succeed");

            let (read_status, read_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/files/read"),
                    Some(json!({"path": test_path})),
                )
                .await;
            assert_eq!(read_status, 200, "read should succeed");
            let read_inner = read_body.get("body").unwrap_or(&read_body);
            let content = read_inner["content"].as_str().unwrap_or("");
            assert!(
                content.contains("Hello from Firecracker"),
                "read content should match written content, got: {content}"
            );

            let (list_status, list_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/files/list"),
                    Some(json!({"path": "/tmp"})),
                )
                .await;
            assert_eq!(list_status, 200, "list should succeed");
            let list_inner = list_body.get("body").unwrap_or(&list_body);
            let files = list_inner
                .as_array()
                .or_else(|| list_inner.get("entries").and_then(|e| e.as_array()));
            if let Some(files) = files {
                let found = files.iter().any(|f| {
                    f.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.contains("fc-test-file"))
                        .unwrap_or(false)
                });
                assert!(found, "listed files should include test file");
            }

            ctx.cleanup(&id).await;
        })
        .await;

        assert!(result.is_ok(), "test_vm_file_ops timed out after 60s");
    }

    #[tokio::test]
    #[ignore]
    async fn test_vm_snapshot() {
        skip_unless_fc!();

        let ctx = TestContext::new();
        let vm_id = unique_vm_id();

        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let (_, body) = ctx
                .api(
                    "POST",
                    "/sandboxes",
                    Some(json!({
                        "image": "alpine:3.19",
                        "timeout": 120,
                        "name": vm_id,
                        "backend": "firecracker"
                    })),
                )
                .await;
            let inner = body.get("body").unwrap_or(&body);
            let id = inner["id"].as_str().unwrap().to_string();

            let (_, _) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/files/write"),
                    Some(json!({
                        "path": "/tmp/state-marker.txt",
                        "content": "pre-snapshot-state"
                    })),
                )
                .await;

            let (snap_status, snap_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/snapshot"),
                    Some(json!({"comment": "test-snap"})),
                )
                .await;
            assert!(
                snap_status == 200 || snap_status == 201,
                "snapshot create should succeed: status={snap_status}, body={snap_body}"
            );
            let snap_inner = snap_body.get("body").unwrap_or(&snap_body);
            let snapshot_id = snap_inner
                .get("snapshotId")
                .or_else(|| snap_inner.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            assert!(!snapshot_id.is_empty(), "snapshot should return an id");

            let (read_status, read_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/files/read"),
                    Some(json!({"path": "/tmp/state-marker.txt"})),
                )
                .await;
            assert_eq!(read_status, 200);
            let read_inner = read_body.get("body").unwrap_or(&read_body);
            let content = read_inner["content"].as_str().unwrap_or("");
            assert!(
                content.contains("pre-snapshot-state"),
                "state should be preserved after snapshot"
            );

            ctx.cleanup(&id).await;
        })
        .await;

        assert!(result.is_ok(), "test_vm_snapshot timed out after 60s");
    }

    #[tokio::test]
    #[ignore]
    async fn test_vm_networking() {
        skip_unless_fc!();

        let ctx = TestContext::new();
        let vm_id = unique_vm_id();

        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let (_, body) = ctx
                .api(
                    "POST",
                    "/sandboxes",
                    Some(json!({
                        "image": "alpine:3.19",
                        "timeout": 120,
                        "name": vm_id,
                        "backend": "firecracker"
                    })),
                )
                .await;
            let inner = body.get("body").unwrap_or(&body);
            let id = inner["id"].as_str().unwrap().to_string();

            let (_, ifconfig_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "ip addr show eth0"})),
                )
                .await;
            let if_inner = ifconfig_body.get("body").unwrap_or(&ifconfig_body);
            let if_stdout = if_inner["stdout"].as_str().unwrap_or("");
            assert!(
                if_stdout.contains("eth0"),
                "guest should have eth0 interface"
            );

            let (_, ip_body) = ctx
                .api("GET", &format!("/sandboxes/{id}/ip"), None)
                .await;
            let ip_inner = ip_body.get("body").unwrap_or(&ip_body);
            let guest_ip = ip_inner
                .get("ip")
                .or_else(|| ip_inner.get("address"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            assert!(
                !guest_ip.is_empty(),
                "sandbox should have an assigned IP"
            );
            assert!(
                guest_ip.contains('.'),
                "IP should be a valid IPv4 format: {guest_ip}"
            );

            let (_, ping_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/exec"),
                    Some(json!({"command": "ping -c 1 -W 3 8.8.8.8 || true"})),
                )
                .await;
            let ping_inner = ping_body.get("body").unwrap_or(&ping_body);
            let _ping_stdout = ping_inner["stdout"].as_str().unwrap_or("");

            ctx.cleanup(&id).await;
        })
        .await;

        assert!(result.is_ok(), "test_vm_networking timed out after 60s");
    }

    #[tokio::test]
    #[ignore]
    async fn test_vm_terminal() {
        skip_unless_fc!();

        let ctx = TestContext::new();
        let vm_id = unique_vm_id();

        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let (_, body) = ctx
                .api(
                    "POST",
                    "/sandboxes",
                    Some(json!({
                        "image": "alpine:3.19",
                        "timeout": 120,
                        "name": vm_id,
                        "backend": "firecracker"
                    })),
                )
                .await;
            let inner = body.get("body").unwrap_or(&body);
            let id = inner["id"].as_str().unwrap().to_string();

            let (term_status, term_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/terminal/create"),
                    Some(json!({
                        "cols": 80,
                        "rows": 24,
                        "shell": "/bin/sh"
                    })),
                )
                .await;
            assert!(
                term_status == 200 || term_status == 201,
                "terminal create should succeed: status={term_status}"
            );
            let term_inner = term_body.get("body").unwrap_or(&term_body);
            let session_id = term_inner["sessionId"]
                .as_str()
                .or_else(|| term_inner["session_id"].as_str())
                .unwrap_or("");
            assert!(!session_id.is_empty(), "terminal should return session_id");

            let (write_status, _) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/terminal/write"),
                    Some(json!({
                        "sessionId": session_id,
                        "data": "echo terminal-test\n"
                    })),
                )
                .await;
            assert_eq!(write_status, 200, "terminal write should succeed");

            tokio::time::sleep(Duration::from_millis(500)).await;

            let (read_status, read_body) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/terminal/read"),
                    Some(json!({"sessionId": session_id})),
                )
                .await;
            assert_eq!(read_status, 200, "terminal read should succeed");
            let read_inner = read_body.get("body").unwrap_or(&read_body);
            let _terminal_output = read_inner["data"].as_str().unwrap_or("");

            let (resize_status, _) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/terminal/resize"),
                    Some(json!({
                        "sessionId": session_id,
                        "cols": 120,
                        "rows": 40
                    })),
                )
                .await;
            assert!(
                resize_status == 200 || resize_status == 204,
                "terminal resize should succeed"
            );

            let (close_status, _) = ctx
                .api(
                    "POST",
                    &format!("/sandboxes/{id}/terminal/close"),
                    Some(json!({"sessionId": session_id})),
                )
                .await;
            assert!(
                close_status == 200 || close_status == 204,
                "terminal close should succeed"
            );

            ctx.cleanup(&id).await;
        })
        .await;

        assert!(result.is_ok(), "test_vm_terminal timed out after 60s");
    }
}
