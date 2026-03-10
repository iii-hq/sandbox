# Isolation Plan: Firecracker MicroVM Option

## Problem

Docker containers share the host kernel — insufficient isolation for multi-tenant.
Competitors: E2B uses Firecracker (150ms boot), Fly uses Firecracker, Modal uses gVisor.

## Solution: Pluggable Isolation Backend

Support both Docker (default, simple) and Firecracker (opt-in, secure).

### Architecture

```rust
pub enum IsolationBackend {
    Docker,
    Firecracker,
}

pub trait SandboxRuntime: Send + Sync {
    async fn create(&self, config: &CreateConfig) -> Result<String>;
    async fn start(&self, id: &str) -> Result<()>;
    async fn stop(&self, id: &str) -> Result<()>;
    async fn exec(&self, id: &str, cmd: &[&str]) -> Result<ExecResult>;
    async fn remove(&self, id: &str) -> Result<()>;
    async fn stats(&self, id: &str) -> Result<ContainerStats>;
    // ... all operations sandbox.rs currently calls on Docker
}
```

### Docker Runtime (current)

Wrap existing bollard calls behind the trait:

```rust
pub struct DockerRuntime {
    docker: Arc<Docker>,
}

impl SandboxRuntime for DockerRuntime { ... }
```

### Firecracker Runtime (new)

```rust
pub struct FirecrackerRuntime {
    socket_dir: PathBuf,     // /tmp/firecracker/
    kernel_path: PathBuf,    // vmlinux
    rootfs_path: PathBuf,    // rootfs.ext4
}

impl SandboxRuntime for FirecrackerRuntime {
    async fn create(&self, config: &CreateConfig) -> Result<String> {
        // 1. Create VM socket
        // 2. Configure machine (vcpus, mem_size_mib)
        // 3. Set kernel + rootfs
        // 4. Start microVM via Firecracker API
    }
    async fn exec(&self, id: &str, cmd: &[&str]) -> Result<ExecResult> {
        // SSH into microVM or use vsock + agent
    }
}
```

### Config

```yaml
isolation:
  backend: docker    # or "firecracker"
  firecracker:
    kernel: /opt/firecracker/vmlinux
    rootfs: /opt/firecracker/rootfs.ext4
    vcpus: 2
    mem_size_mib: 512
```

### Dependencies

```toml
[dependencies]
# Firecracker API client (optional)
firecracker-sdk = { version = "0.1", optional = true }

[features]
default = ["docker"]
firecracker = ["dep:firecracker-sdk"]
```

### Migration Path

1. **Phase 1**: Extract `SandboxRuntime` trait from current Docker code
2. **Phase 2**: Implement `DockerRuntime` behind the trait (no behavior change)
3. **Phase 3**: Implement `FirecrackerRuntime` behind feature flag
4. **Phase 4**: Add rootfs builder (convert Docker images to ext4)

### Trade-offs

| | Docker | Firecracker |
|---|--------|------------|
| Boot time | ~2s | ~150ms |
| Isolation | Kernel shared | Full VM |
| Memory overhead | ~10MB | ~30MB |
| Complexity | Low | High |
| Host requirement | Docker daemon | KVM + Firecracker binary |
| Image format | OCI | ext4 rootfs |

### Files to Create/Modify

| File | Action |
|------|--------|
| `packages/worker/src/runtime/mod.rs` | CREATE — trait definition |
| `packages/worker/src/runtime/docker.rs` | CREATE — Docker impl |
| `packages/worker/src/runtime/firecracker.rs` | CREATE — Firecracker impl |
| `packages/worker/src/functions/sandbox.rs` | MODIFY — use trait |
| `packages/worker/src/main.rs` | MODIFY — select runtime |
| `packages/worker/src/config.rs` | MODIFY — isolation config |
| `packages/worker/Cargo.toml` | MODIFY — feature flags |
