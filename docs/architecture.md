# Architecture

## Worker

The Rust worker registers **107 iii-engine functions** across 24 modules. Compiles to a **6.6 MB release binary** with a pluggable `SandboxRuntime` trait.

```
functions/
  sandbox.rs       7 fns   Sandbox CRUD + pause/resume/renew
  command.rs       2 fns   exec + exec/stream (real SSE)
  filesystem.rs   12 fns   Full filesystem operations
  interpreter.rs   3 fns   Multi-language code execution
  background.rs    4 fns   Background tasks + interrupt
  metrics.rs       2 fns   Per-sandbox + global metrics
  env.rs           4 fns   Environment variable management
  git.rs           9 fns   Clone, status, commit, diff, log, branch, checkout, push, pull
  process.rs       3 fns   Process list, kill, top
  template.rs      4 fns   Template CRUD
  snapshot.rs      6 fns   Create, restore, list, delete, get-owner, clone
  port.rs          3 fns   Port expose, list, unexpose
  clone.rs         1 fn    Clone sandbox with state
  event.rs         4 fns   Event publish, subscribe, history, stream
  queue.rs         5 fns   Async exec queue with DLQ + retries
  network.rs       5 fns   Docker network management
  observability.rs 4 fns   Traces, metrics, clear
  stream.rs        3 fns   Real-time log/metrics/event streaming (SSE)
  monitor.rs       5 fns   Resource alerts with auto-actions
  volume.rs        5 fns   Persistent volume management
  terminal.rs      3 fns   Interactive PTY sessions via iii channels
  proxy.rs         2 fns   HTTP proxy with exec-based fallback
  warmpool.rs      4 fns   Pre-warmed container pool management
  worker.rs        6 fns   Multi-worker scaling, routing, reaper
```

## Triggers

**104 total** across 3 types:
- **HTTP** (93): REST endpoints on port 3111
- **Cron** (3): TTL sweep (30s), worker heartbeat (10s), dead worker reaper (60s)
- **Queue** (8): Event subscribers for `sandbox.created`, `sandbox.killed`, `sandbox.expired`, etc.

## State (KV Scopes)

State is managed through iii-engine's built-in KV store:

| Scope | Contents |
|-------|----------|
| `sandbox` | Sandbox metadata and config |
| `background` | Background exec tracking |
| `global` | Counters and uptime |
| `snapshots` | Snapshot metadata |
| `templates` | Template presets |
| `queue` | Execution queue jobs |
| `networks` | Docker network mappings |
| `volumes` | Persistent volume tracking |
| `alerts` | Resource alert configurations |
| `events` | Event history |
| `traces` | Observability traces |
| `metrics` | Aggregated metrics |
| `terminal` | Interactive terminal sessions |
| `pool` | Warm pool container tracking |
| `workers` | Multi-worker registration and liveness |

## SandboxRuntime Trait

29 async methods abstracting the container backend:

| Backend | Status | Crate | Feature Flag |
|---------|--------|-------|--------------|
| Docker | Production | `bollard` | default |
| Firecracker | Production | `bollard` + guest agent | `firecracker` |

Selected via `III_ISOLATION_BACKEND` env var. Covers sandbox lifecycle, exec, filesystem, networking, volumes, and snapshotting.

## Firecracker MicroVM Backend

Each sandbox runs in its own KVM-based microVM with a dedicated kernel, rootfs, and network stack.

**How it works:**
1. OCI image is converted to ext4 rootfs (cached)
2. Firecracker process starts with vmlinux kernel + rootfs
3. Guest agent (std-only Rust binary) runs inside the VM
4. Host communicates with guest agent over VSOCK (port 52)
5. TAP device + iptables NAT provides networking

**Components:**
- Guest agent: std-only Rust binary, PTY support, 16 concurrent terminal sessions
- OCI-to-ext4 rootfs converter with layer merging
- Subnet allocator: 253 VMs per host
- Init system: parses kernel cmdline `ip=` parameter for networking
- Snapshot create/restore via Firecracker API
- Cross-compiled for x86_64 + aarch64 musl

## Multi-Worker Scaling

Multiple worker instances run concurrently, each managing its own sandboxes:

- **Heartbeat**: Each worker reports liveness every 10s
- **Selection**: `worker::select` picks the least-loaded worker
- **Routing**: Sandbox-scoped API calls forwarded to owning worker
- **Reaper**: Dead workers (no heartbeat 30s) cleaned up, orphaned sandboxes reassigned
- **Ownership**: Each sandbox tracks its `worker_id`

## Security

Each sandbox container runs with:
- `no-new-privileges` security option
- Dropped capabilities: `NET_RAW`, `SYS_ADMIN`, `MKNOD`
- PID limit: 256 processes
- Network isolation: disabled by default
- Configurable memory (64-4096 MB) and CPU (0.5-4 cores)

Input validation:
- Path traversal prevention (normalized against workspace root)
- Image whitelist (`III_ALLOWED_IMAGES`)
- Command wrapping inside `sh -c`
- Env key validation (`[A-Za-z_][A-Za-z0-9_]*`)
- Bearer token auth (`III_AUTH_TOKEN`)
- Shell injection prevention (args quoted/sanitized)
- Terminal shell allowlist (`/bin/sh`, `/bin/bash`, `/bin/zsh`, `/bin/ash`)
- Proxy injection prevention (argv-based exec, `--data-raw`, `--globoff`)
- Output capping (stdout/stderr size limits)
- Rate limiting (per-token, configurable)
