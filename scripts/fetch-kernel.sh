#!/usr/bin/env bash
set -euo pipefail

FC_VERSION="${FC_VERSION:-v1.12}"
KERNEL_VERSION="${KERNEL_VERSION:-5.10.225}"
DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"

usage() {
    printf "Usage: %s [OPTIONS]\n\n" "$0"
    printf "Download a pre-built Firecracker-compatible Linux kernel.\n\n"
    printf "Options:\n"
    printf "  --version VER    Firecracker CI version (default: %s)\n" "$FC_VERSION"
    printf "  --kernel VER     Kernel version (default: %s)\n" "$KERNEL_VERSION"
    printf "  --arch ARCH      Architecture: x86_64 or aarch64 (default: auto-detect)\n"
    printf "  --output DIR     Output directory (default: %s)\n" "$DATA_DIR"
    printf "  --force          Re-download even if the file exists\n"
    printf "  -h, --help       Show this help\n"
    exit 0
}

detect_arch() {
    local machine
    machine="$(uname -m)"
    case "$machine" in
        x86_64|amd64)  echo "x86_64" ;;
        aarch64|arm64) echo "aarch64" ;;
        *)
            printf "ERROR: Unsupported architecture: %s\n" "$machine" >&2
            exit 1
            ;;
    esac
}

ARCH=""
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)  FC_VERSION="$2"; shift 2 ;;
        --kernel)   KERNEL_VERSION="$2"; shift 2 ;;
        --arch)     ARCH="$2"; shift 2 ;;
        --output)   DATA_DIR="$2"; shift 2 ;;
        --force)    FORCE=1; shift ;;
        -h|--help)  usage ;;
        *)
            printf "ERROR: Unknown option: %s\n" "$1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$ARCH" ]]; then
    ARCH="$(detect_arch)"
fi

case "$ARCH" in
    x86_64|aarch64) ;;
    *)
        printf "ERROR: Architecture must be x86_64 or aarch64, got: %s\n" "$ARCH" >&2
        exit 1
        ;;
esac

KERNEL_FILE="vmlinux-${KERNEL_VERSION}-${ARCH}"
KERNEL_PATH="${DATA_DIR}/${KERNEL_FILE}"
SYMLINK_PATH="${DATA_DIR}/vmlinux"
BASE_URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/${FC_VERSION}/${ARCH}"
KERNEL_URL="${BASE_URL}/vmlinux-${KERNEL_VERSION}"
SHA256_URL="${BASE_URL}/vmlinux-${KERNEL_VERSION}.sha256"

mkdir -p "$DATA_DIR"

if [[ -f "$KERNEL_PATH" && "$FORCE" -eq 0 ]]; then
    printf "Kernel already exists: %s\n" "$KERNEL_PATH"
    if [[ ! -L "$SYMLINK_PATH" ]] || [[ "$(readlink "$SYMLINK_PATH")" != "$KERNEL_FILE" ]]; then
        ln -sf "$KERNEL_FILE" "$SYMLINK_PATH"
        printf "Updated symlink: %s -> %s\n" "$SYMLINK_PATH" "$KERNEL_FILE"
    fi
    exit 0
fi

download() {
    local url="$1"
    local dest="$2"
    if command -v curl &>/dev/null; then
        curl -fSL --retry 3 --retry-delay 2 -o "$dest" "$url"
    elif command -v wget &>/dev/null; then
        wget -q --tries=3 -O "$dest" "$url"
    else
        printf "ERROR: Neither curl nor wget found\n" >&2
        exit 1
    fi
}

printf "Downloading kernel: %s\n" "$KERNEL_URL"
printf "  Architecture: %s\n" "$ARCH"
printf "  Destination:  %s\n" "$KERNEL_PATH"

TEMP_PATH="${KERNEL_PATH}.tmp"
trap 'rm -f "$TEMP_PATH"' EXIT

download "$KERNEL_URL" "$TEMP_PATH"

CHECKSUM_VERIFIED=0
TEMP_SHA="${KERNEL_PATH}.sha256.tmp"
if download "$SHA256_URL" "$TEMP_SHA" 2>/dev/null; then
    EXPECTED_SHA="$(awk '{print $1}' "$TEMP_SHA")"
    if [[ -n "$EXPECTED_SHA" ]]; then
        if command -v sha256sum &>/dev/null; then
            ACTUAL_SHA="$(sha256sum "$TEMP_PATH" | awk '{print $1}')"
        elif command -v shasum &>/dev/null; then
            ACTUAL_SHA="$(shasum -a 256 "$TEMP_PATH" | awk '{print $1}')"
        else
            printf "WARNING: No sha256sum or shasum available, skipping checksum verification\n" >&2
            ACTUAL_SHA=""
        fi

        if [[ -n "$ACTUAL_SHA" ]]; then
            if [[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]]; then
                printf "Checksum verified: %s\n" "$ACTUAL_SHA"
                CHECKSUM_VERIFIED=1
            else
                printf "ERROR: Checksum mismatch!\n" >&2
                printf "  Expected: %s\n" "$EXPECTED_SHA" >&2
                printf "  Actual:   %s\n" "$ACTUAL_SHA" >&2
                rm -f "$TEMP_PATH" "$TEMP_SHA"
                exit 1
            fi
        fi
    fi
    rm -f "$TEMP_SHA"
else
    printf "No checksum file available, skipping verification\n"
    rm -f "$TEMP_SHA"
fi

mv "$TEMP_PATH" "$KERNEL_PATH"
chmod 644 "$KERNEL_PATH"
trap - EXIT

ln -sf "$KERNEL_FILE" "$SYMLINK_PATH"

FILE_SIZE="$(wc -c < "$KERNEL_PATH" | tr -d ' ')"
printf "Kernel downloaded: %s (%s bytes)\n" "$KERNEL_PATH" "$FILE_SIZE"
printf "Symlink: %s -> %s\n" "$SYMLINK_PATH" "$KERNEL_FILE"
if [[ "$CHECKSUM_VERIFIED" -eq 1 ]]; then
    printf "Checksum: verified\n"
else
    printf "Checksum: not verified (no checksum file available)\n"
fi
