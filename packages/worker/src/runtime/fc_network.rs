use std::collections::HashMap;
use tokio::process::Command;

pub struct SubnetAllocator {
    base: [u8; 2],
    allocated: HashMap<String, u8>,
    free_list: Vec<u8>,
    next_subnet: u8,
}

impl SubnetAllocator {
    pub fn new(base: [u8; 2]) -> Self {
        Self {
            base,
            allocated: HashMap::new(),
            free_list: Vec::new(),
            next_subnet: 1,
        }
    }

    pub fn allocate(&mut self, vm_id: &str) -> Result<SubnetInfo, String> {
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

    pub fn release(&mut self, vm_id: &str) {
        if let Some(subnet_id) = self.allocated.remove(vm_id) {
            self.free_list.push(subnet_id);
        }
    }

    pub fn get(&self, vm_id: &str) -> Option<SubnetInfo> {
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

#[derive(Debug, Clone)]
pub struct SubnetInfo {
    pub host_ip: String,
    pub guest_ip: String,
    pub netmask: String,
    pub subnet_id: u8,
}

pub fn generate_mac(vm_index: u8) -> String {
    format!("AA:FC:00:00:00:{:02X}", vm_index)
}

pub async fn create_tap_device(tap_name: &str, host_ip: &str) -> Result<(), String> {
    run_cmd("ip", &["tuntap", "add", "dev", tap_name, "mode", "tap"]).await?;

    if let Err(e) = run_cmd("ip", &["addr", "add", &format!("{host_ip}/30"), "dev", tap_name]).await {
        let _ = run_cmd("ip", &["link", "del", tap_name]).await;
        return Err(e);
    }

    if let Err(e) = run_cmd("ip", &["link", "set", "dev", tap_name, "up"]).await {
        let _ = run_cmd("ip", &["link", "del", tap_name]).await;
        return Err(e);
    }

    Ok(())
}

pub async fn delete_tap_device(tap_name: &str) -> Result<(), String> {
    run_cmd("ip", &["link", "del", tap_name]).await.ok();
    Ok(())
}

pub async fn setup_nat(tap_name: &str, guest_subnet: &str) -> Result<(), String> {
    run_cmd(
        "iptables",
        &["-t", "nat", "-A", "POSTROUTING", "-o", "eth0", "-s", guest_subnet, "-j", "MASQUERADE"],
    )
    .await?;

    run_cmd(
        "iptables",
        &["-A", "FORWARD", "-i", tap_name, "-o", "eth0", "-j", "ACCEPT"],
    )
    .await?;

    run_cmd(
        "iptables",
        &["-A", "FORWARD", "-i", "eth0", "-o", tap_name, "-m", "state", "--state", "RELATED,ESTABLISHED", "-j", "ACCEPT"],
    )
    .await?;

    Ok(())
}

pub async fn teardown_nat(tap_name: &str, guest_subnet: &str) -> Result<(), String> {
    run_cmd(
        "iptables",
        &["-t", "nat", "-D", "POSTROUTING", "-o", "eth0", "-s", guest_subnet, "-j", "MASQUERADE"],
    )
    .await
    .ok();

    run_cmd(
        "iptables",
        &["-D", "FORWARD", "-i", tap_name, "-o", "eth0", "-j", "ACCEPT"],
    )
    .await
    .ok();

    run_cmd(
        "iptables",
        &["-D", "FORWARD", "-i", "eth0", "-o", tap_name, "-m", "state", "--state", "RELATED,ESTABLISHED", "-j", "ACCEPT"],
    )
    .await
    .ok();

    Ok(())
}

pub async fn add_port_forward(
    host_port: u16,
    guest_ip: &str,
    guest_port: u16,
) -> Result<(), String> {
    run_cmd(
        "iptables",
        &[
            "-t", "nat", "-A", "PREROUTING",
            "-p", "tcp", "--dport", &host_port.to_string(),
            "-j", "DNAT", "--to-destination", &format!("{guest_ip}:{guest_port}"),
        ],
    )
    .await
}

pub async fn remove_port_forward(
    host_port: u16,
    guest_ip: &str,
    guest_port: u16,
) -> Result<(), String> {
    run_cmd(
        "iptables",
        &[
            "-t", "nat", "-D", "PREROUTING",
            "-p", "tcp", "--dport", &host_port.to_string(),
            "-j", "DNAT", "--to-destination", &format!("{guest_ip}:{guest_port}"),
        ],
    )
    .await
    .ok();
    Ok(())
}

async fn run_cmd(cmd: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{cmd} failed: {stderr}"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subnet_allocator_basic() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        let info = alloc.allocate("vm1").unwrap();
        assert_eq!(info.host_ip, "172.16.1.1");
        assert_eq!(info.guest_ip, "172.16.1.2");
        assert_eq!(info.subnet_id, 1);

        let info2 = alloc.allocate("vm2").unwrap();
        assert_eq!(info2.host_ip, "172.16.2.1");
        assert_eq!(info2.guest_ip, "172.16.2.2");
    }

    #[test]
    fn subnet_allocator_release_and_get() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        alloc.allocate("vm1").unwrap();

        let info = alloc.get("vm1");
        assert!(info.is_some());
        assert_eq!(info.unwrap().guest_ip, "172.16.1.2");

        alloc.release("vm1");
        assert!(alloc.get("vm1").is_none());
    }

    #[test]
    fn subnet_allocator_exhaustion() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        alloc.next_subnet = 254;
        let result = alloc.allocate("vm_overflow");
        assert!(result.is_err());
    }

    #[test]
    fn generate_mac_format() {
        assert_eq!(generate_mac(1), "AA:FC:00:00:00:01");
        assert_eq!(generate_mac(255), "AA:FC:00:00:00:FF");
        assert_eq!(generate_mac(16), "AA:FC:00:00:00:10");
    }

    #[test]
    fn subnet_info_netmask() {
        let mut alloc = SubnetAllocator::new([10, 0]);
        let info = alloc.allocate("vm1").unwrap();
        assert_eq!(info.netmask, "255.255.255.252");
    }

    #[test]
    fn subnet_allocator_reclaim() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        let info1 = alloc.allocate("vm1").unwrap();
        assert_eq!(info1.subnet_id, 1);

        alloc.allocate("vm2").unwrap();
        alloc.release("vm1");

        let info3 = alloc.allocate("vm3").unwrap();
        assert_eq!(info3.subnet_id, 1);
    }

    #[test]
    fn subnet_allocator_idempotent() {
        let mut alloc = SubnetAllocator::new([172, 16]);
        let info1 = alloc.allocate("vm1").unwrap();
        let info2 = alloc.allocate("vm1").unwrap();
        assert_eq!(info1.subnet_id, info2.subnet_id);
        assert_eq!(alloc.next_subnet, 2);
    }
}
