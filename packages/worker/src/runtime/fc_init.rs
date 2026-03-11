use std::path::Path;
use tokio::fs;

pub const INIT_SCRIPT: &str = r#"#!/bin/sh

mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts
mount -t tmpfs tmpfs /tmp
mount -t tmpfs tmpfs /run

hostname "$(cat /etc/hostname 2>/dev/null || echo iii-sandbox)"

parse_cmdline() {
    local cmdline
    cmdline="$(cat /proc/cmdline)"
    for param in $cmdline; do
        case "$param" in
            ip=*)
                echo "${param#ip=}"
                return
                ;;
        esac
    done
}

setup_network() {
    local ip_param
    ip_param="$(parse_cmdline)"
    if [ -z "$ip_param" ]; then
        return 1
    fi

    local guest_ip host_ip netmask
    guest_ip="$(echo "$ip_param" | cut -d: -f1)"
    host_ip="$(echo "$ip_param" | cut -d: -f3)"
    netmask="$(echo "$ip_param" | cut -d: -f4)"

    if [ -z "$guest_ip" ] || [ -z "$host_ip" ]; then
        return 1
    fi

    local cidr="30"
    case "$netmask" in
        255.255.255.252) cidr="30" ;;
        255.255.255.248) cidr="29" ;;
        255.255.255.0)   cidr="24" ;;
    esac

    ip link set lo up
    ip link set eth0 up
    ip addr add "${guest_ip}/${cidr}" dev eth0
    ip route add default via "$host_ip"
}

setup_dns() {
    if [ ! -f /etc/resolv.conf ] || [ ! -s /etc/resolv.conf ]; then
        echo "nameserver 8.8.8.8" > /etc/resolv.conf
        echo "nameserver 8.8.4.4" >> /etc/resolv.conf
    fi
}

graceful_shutdown() {
    echo "Init: shutting down..."
    if [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null; then
        kill -TERM "$AGENT_PID"
        local count=0
        while kill -0 "$AGENT_PID" 2>/dev/null && [ "$count" -lt 10 ]; do
            sleep 0.5
            count=$((count + 1))
        done
        if kill -0 "$AGENT_PID" 2>/dev/null; then
            kill -KILL "$AGENT_PID" 2>/dev/null || true
        fi
    fi
    umount /tmp 2>/dev/null || true
    umount /run 2>/dev/null || true
    umount /dev/pts 2>/dev/null || true
    umount /dev 2>/dev/null || true
    umount /sys 2>/dev/null || true
    umount /proc 2>/dev/null || true
    echo "Init: sync and poweroff"
    sync
    reboot -f
}

AGENT_PID=""
trap graceful_shutdown TERM INT

echo "Init: mounting filesystems"

echo "Init: configuring network"
if ! setup_network; then
    echo "Init: WARNING - network setup failed, guest agent may not be reachable" >&2
fi
setup_dns

AGENT_BIN="/usr/local/bin/iii-guest-agent"
if [ -x "$AGENT_BIN" ]; then
    echo "Init: starting guest agent"
    "$AGENT_BIN" &
    AGENT_PID=$!
    echo "Init: guest agent started (pid=$AGENT_PID)"
else
    echo "Init: WARNING - guest agent not found at $AGENT_BIN" >&2
fi

echo "Init: system ready"

while true; do
    wait || true
done
"#;

pub async fn inject_init(merged_dir: &Path) -> Result<(), String> {
    let sbin_dir = merged_dir.join("sbin");
    fs::create_dir_all(&sbin_dir)
        .await
        .map_err(|e| format!("Failed to create /sbin in rootfs: {e}"))?;

    let init_path = sbin_dir.join("init");
    fs::write(&init_path, INIT_SCRIPT)
        .await
        .map_err(|e| format!("Failed to write /sbin/init: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        fs::set_permissions(&init_path, perms)
            .await
            .map_err(|e| format!("Failed to set init permissions: {e}"))?;
    }

    for dir in &["proc", "sys", "dev", "dev/pts", "tmp", "run", "var/log"] {
        let dir_path = merged_dir.join(dir);
        fs::create_dir_all(&dir_path)
            .await
            .map_err(|e| format!("Failed to create /{dir} in rootfs: {e}"))?;
    }

    let etc_dir = merged_dir.join("etc");
    fs::create_dir_all(&etc_dir)
        .await
        .map_err(|e| format!("Failed to create /etc in rootfs: {e}"))?;

    let hostname_path = etc_dir.join("hostname");
    if !hostname_path.exists() {
        fs::write(&hostname_path, "iii-sandbox\n")
            .await
            .map_err(|e| format!("Failed to write /etc/hostname: {e}"))?;
    }

    let resolv_path = etc_dir.join("resolv.conf");
    if !resolv_path.exists() {
        fs::write(&resolv_path, "nameserver 8.8.8.8\nnameserver 8.8.4.4\n")
            .await
            .map_err(|e| format!("Failed to write /etc/resolv.conf: {e}"))?;
    }

    tracing::info!(
        path = %init_path.display(),
        "Injected init system into rootfs"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_script_starts_with_shebang() {
        assert!(INIT_SCRIPT.starts_with("#!/bin/sh"));
    }

    #[test]
    fn init_script_mounts_proc() {
        assert!(INIT_SCRIPT.contains("mount -t proc proc /proc"));
    }

    #[test]
    fn init_script_mounts_sysfs() {
        assert!(INIT_SCRIPT.contains("mount -t sysfs sysfs /sys"));
    }

    #[test]
    fn init_script_mounts_devtmpfs() {
        assert!(INIT_SCRIPT.contains("mount -t devtmpfs devtmpfs /dev"));
    }

    #[test]
    fn init_script_mounts_devpts() {
        assert!(INIT_SCRIPT.contains("mount -t devpts devpts /dev/pts"));
    }

    #[test]
    fn init_script_mounts_tmpfs() {
        assert!(INIT_SCRIPT.contains("mount -t tmpfs tmpfs /tmp"));
    }

    #[test]
    fn init_script_starts_guest_agent() {
        assert!(INIT_SCRIPT.contains("/usr/local/bin/iii-guest-agent"));
    }

    #[test]
    fn init_script_handles_sigterm() {
        assert!(INIT_SCRIPT.contains("trap graceful_shutdown TERM INT"));
    }

    #[test]
    fn init_script_parses_kernel_cmdline() {
        assert!(INIT_SCRIPT.contains("parse_cmdline"));
        assert!(INIT_SCRIPT.contains("/proc/cmdline"));
    }

    #[test]
    fn init_script_sets_up_dns() {
        assert!(INIT_SCRIPT.contains("nameserver 8.8.8.8"));
    }

    #[tokio::test]
    async fn inject_init_creates_files() {
        let tmp = std::env::temp_dir().join("fc_init_test_inject");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        inject_init(&tmp).await.unwrap();

        assert!(tmp.join("sbin/init").exists());
        assert!(tmp.join("proc").exists());
        assert!(tmp.join("sys").exists());
        assert!(tmp.join("dev/pts").exists());
        assert!(tmp.join("tmp").exists());
        assert!(tmp.join("run").exists());
        assert!(tmp.join("etc/hostname").exists());
        assert!(tmp.join("etc/resolv.conf").exists());

        let init_content = std::fs::read_to_string(tmp.join("sbin/init")).unwrap();
        assert!(init_content.starts_with("#!/bin/sh"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = std::fs::metadata(tmp.join("sbin/init")).unwrap();
            let mode = meta.permissions().mode();
            assert_eq!(mode & 0o755, 0o755);
        }

        let hostname = std::fs::read_to_string(tmp.join("etc/hostname")).unwrap();
        assert_eq!(hostname.trim(), "iii-sandbox");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn inject_init_preserves_existing_hostname() {
        let tmp = std::env::temp_dir().join("fc_init_test_hostname");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("etc")).unwrap();
        std::fs::write(tmp.join("etc/hostname"), "my-custom-host\n").unwrap();

        inject_init(&tmp).await.unwrap();

        let hostname = std::fs::read_to_string(tmp.join("etc/hostname")).unwrap();
        assert_eq!(hostname.trim(), "my-custom-host");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn inject_init_preserves_existing_resolv_conf() {
        let tmp = std::env::temp_dir().join("fc_init_test_resolv");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("etc")).unwrap();
        std::fs::write(tmp.join("etc/resolv.conf"), "nameserver 1.1.1.1\n").unwrap();

        inject_init(&tmp).await.unwrap();

        let resolv = std::fs::read_to_string(tmp.join("etc/resolv.conf")).unwrap();
        assert!(resolv.contains("1.1.1.1"));
        assert!(!resolv.contains("8.8.8.8"));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
