#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf "Usage: %s <rootfs-dir> [OPTIONS]\n\n" "$0"
    printf "Inject a minimal init system into a Firecracker VM rootfs directory.\n\n"
    printf "Arguments:\n"
    printf "  rootfs-dir       Path to the merged rootfs directory\n\n"
    printf "Options:\n"
    printf "  --agent-path P   Path to guest agent binary inside rootfs\n"
    printf "                   (default: /usr/local/bin/iii-guest-agent)\n"
    printf "  --hostname NAME  VM hostname (default: iii-sandbox)\n"
    printf "  -h, --help       Show this help\n"
    exit 0
}

ROOTFS_DIR=""
AGENT_PATH="/usr/local/bin/iii-guest-agent"
HOSTNAME="iii-sandbox"

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)       usage ;;
        --agent-path)    AGENT_PATH="$2"; shift 2 ;;
        --hostname)      HOSTNAME="$2"; shift 2 ;;
        -*)
            printf "ERROR: Unknown option: %s\n" "$1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$ROOTFS_DIR" ]]; then
                ROOTFS_DIR="$1"
                shift
            else
                printf "ERROR: Unexpected argument: %s\n" "$1" >&2
                exit 1
            fi
            ;;
    esac
done

if [[ -z "$ROOTFS_DIR" ]]; then
    printf "ERROR: rootfs-dir is required\n" >&2
    usage
fi

if [[ ! -d "$ROOTFS_DIR" ]]; then
    printf "ERROR: Directory does not exist: %s\n" "$ROOTFS_DIR" >&2
    exit 1
fi

mkdir -p "${ROOTFS_DIR}/sbin"
mkdir -p "${ROOTFS_DIR}/proc"
mkdir -p "${ROOTFS_DIR}/sys"
mkdir -p "${ROOTFS_DIR}/dev"
mkdir -p "${ROOTFS_DIR}/dev/pts"
mkdir -p "${ROOTFS_DIR}/tmp"
mkdir -p "${ROOTFS_DIR}/run"
mkdir -p "${ROOTFS_DIR}/var/log"
mkdir -p "${ROOTFS_DIR}/etc"

cat > "${ROOTFS_DIR}/sbin/init" << 'INITEOF'
#!/bin/sh

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
INITEOF

chmod 755 "${ROOTFS_DIR}/sbin/init"

echo "$HOSTNAME" > "${ROOTFS_DIR}/etc/hostname"

if [ ! -f "${ROOTFS_DIR}/etc/resolv.conf" ]; then
    printf "nameserver 8.8.8.8\nnameserver 8.8.4.4\n" > "${ROOTFS_DIR}/etc/resolv.conf"
fi

printf "Injected init system into %s/sbin/init\n" "$ROOTFS_DIR"
printf "  Agent path: %s\n" "$AGENT_PATH"
printf "  Hostname:   %s\n" "$HOSTNAME"
