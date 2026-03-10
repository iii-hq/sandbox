# iii-sandbox

Secure, isolated Docker sandboxes for code execution. Built on [iii-engine](https://github.com/iii-hq/iii) primitives (Worker / Function / Trigger).

```
  ┌──────────┐ ┌───────────┐ ┌───────────┐
  │ SDK (TS) │ │ SDK (Rust)│ │  SDK (Py) │
  └────┬─────┘ └─────┬─────┘ └─────┬─────┘
       └─────────────┼─────────────┘
  ┌───────┐          │          ┌───────┐
  │  CLI  │──────────┼──────────│  MCP  │
  └───────┘          ▼          └───────┘
  ┌─────────────────────────────────────────┐
  │        REST API  (port 3111)            │
  └────────────────┬────────────────────────┘
                   ▼
  ┌──────────────────────────────────────────┐
  │          iii-engine  (Rust)              │
  │   ┌────────┐ ┌──────┐ ┌────────────┐     │
  │   │ KV     │ │ Cron │ │ Event Queue│     │
  │   └────────┘ └──────┘ └────────────┘     │
  └────────────────┬─────────────────────────┘
                   ▼
  ┌─────────────────────────────────────────┐
  │        Worker  (iii-sdk, Rust)          │
  │                                         │
  │ 107 Functions · 93 Endpoints · 39 Tools │
  │  sandbox · exec · fs · git · env · proc │
  │  snapshot · template · port · queue     │
  │  event · stream · monitor · volume · net│
  │  terminal · proxy · warmpool · worker   │
  └────────────────┬────────────────────────┘
                   ▼
  ┌─────────────────────────────────────────┐
  │      SandboxRuntime (trait)             │
  │  ┌────────────────┐ ┌───────────────┐   │
  │  │ DockerRuntime  │ │ Firecracker*  │   │
  │  │ (bollard)      │ │ (stub)        │   │
  │  └────────┬───────┘ └───────────────┘   │
  └───────────┼─────────────────────────────┘
              ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │ sbx_01 │ │ sbx_02 │ │ sbx_03 │ │ sbx_04 │
  │ python │ │  node  │ │ golang │ │  bash  │
  └────────┘ └────────┘ └────────┘ └────────┘
              Docker Containers
```

## Quick Start

**Prerequisites**: Docker, Node.js >= 20, pnpm >= 9, Rust >= 1.82, [iii-engine](https://github.com/iii-hq/iii) binary

```bash
# 1. Start the iii-engine
iii --config iii-config.yaml

# 2. Start the sandbox worker
cd packages/worker && cargo run

# 3. Create a sandbox
curl -X POST http://localhost:3111/sandbox/sandboxes \
  -H "Content-Type: application/json" \
  -d '{"image": "python:3.12-slim"}'

# 4. Execute a command
curl -X POST http://localhost:3111/sandbox/sandboxes/<id>/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "python3 -c \"print(2+2)\""}'
```

## Installation

```bash
git clone https://github.com/iii-hq/sandbox.git
cd sandbox
pnpm install
pnpm build
```

## Packages

| Package | Description | Entry |
|---------|-------------|-------|
| `iii-sandbox-worker` | Rust binary — 107 functions, 104 triggers, pluggable runtime | `packages/worker` |
| `@iii-sandbox/sdk` | Zero-dependency client library for Node.js | `packages/sdk` |
| `iii-sandbox` (Python) | Async Python client (httpx + pydantic) | `packages/sdk-python` |
| `iii-sandbox` (Rust) | Async Rust client (reqwest + serde) | `packages/sdk-rust` |
| `@iii-sandbox/cli` | Command-line interface (11 commands) | `packages/cli` |
| `@iii-sandbox/mcp` | MCP server with 39 AI tools | `packages/mcp` |

## SDK Usage

```typescript
import { createSandbox } from "@iii-sandbox/sdk"

const sbx = await createSandbox({ image: "python:3.12-slim" })

// Execute commands
const result = await sbx.exec("python3 --version")
console.log(result.stdout)  // "Python 3.12.x"

// Stream output in real-time (SSE)
for await (const chunk of sbx.execStream("for i in $(seq 1 5); do echo $i; sleep 0.5; done")) {
  process.stdout.write(`[${chunk.type}] ${chunk.data}`)
}

// File operations
await sbx.filesystem.write("/workspace/app.py", "print('hello')")
const content = await sbx.filesystem.read("/workspace/app.py")
const files = await sbx.filesystem.list("/workspace")

// Code interpreter (Python, JavaScript, TypeScript, Go, Bash)
const py = await sbx.interpreter.run("print(sum(range(100)))", "python")
console.log(py.output)  // "4950"

// Resource metrics
const metrics = await sbx.metrics()
console.log(`CPU: ${metrics.cpuPercent}%, Memory: ${metrics.memoryUsageMb}MB`)

// Environment variables
await sbx.env.set("API_KEY", "sk-123")
const val = await sbx.env.get("API_KEY")
const allEnv = await sbx.env.list()

// Git operations
await sbx.git.clone("https://github.com/user/repo.git")
const status = await sbx.git.status()
await sbx.git.commit("Initial commit", { all: true })

// Process management
const procs = await sbx.processes.list()
await sbx.processes.kill(1234, "TERM")

// Snapshots
const snap = await sbx.snapshot()
await sbx.restore(snap.snapshotId)

// Port forwarding
await sbx.ports.expose(8080, 3000)
const ports = await sbx.ports.list()

// Interactive terminal (PTY via iii channels)
const session = await sbx.terminal.create({ shell: "/bin/bash", cols: 120, rows: 40 })
console.log(session.sessionId, session.channel)
await sbx.terminal.resize(session.sessionId, 200, 50)
await sbx.terminal.close(session.sessionId)

// HTTP proxy (forward requests to container ports)
const proxyUrl = sbx.ports.getProxyUrl(8080)

// Lifecycle
await sbx.pause()
await sbx.resume()
await sbx.kill()
```

### Connect to an existing sandbox

```typescript
import { getSandbox, listSandboxes } from "@iii-sandbox/sdk"

const all = await listSandboxes()
const sbx = await getSandbox("sbx_a1b2c3d4e5f6")
```

### Python SDK

```bash
pip install iii-sandbox
```

```python
from iii_sandbox import create_sandbox, list_sandboxes, get_sandbox

sbx = await create_sandbox(image="python:3.12-slim")

result = await sbx.exec("python3 --version")
print(result.stdout)

await sbx.filesystem.write("/workspace/app.py", "print('hello')")
content = await sbx.filesystem.read("/workspace/app.py")
files = await sbx.filesystem.list("/workspace")

py = await sbx.interpreter.run("print(sum(range(100)))", "python")
print(py.output)

await sbx.env.set({"API_KEY": "sk-123"})
val = await sbx.env.get("API_KEY")

await sbx.git.clone("https://github.com/user/repo.git")
status = await sbx.git.status()

async for chunk in sbx.exec_stream("ls -la"):
    print(f"[{chunk.type}] {chunk.data}")

async for log in sbx.streams.logs(follow=True):
    print(log.data)

snap = await sbx.snapshot()
await sbx.restore(snap.id)

await sbx.pause()
await sbx.resume()
await sbx.kill()
```

### Rust SDK

```toml
# Cargo.toml
[dependencies]
iii-sandbox = "0.1"
tokio = { version = "1", features = ["full"] }
futures-util = "0.3"
```

```rust
use iii_sandbox::{create_sandbox, list_sandboxes, SandboxCreateOptions, ClientConfig};
use futures_util::StreamExt;

let options = SandboxCreateOptions {
    image: Some("python:3.12-slim".into()),
    ..Default::default()
};
let sbx = create_sandbox(options, None).await?;

let result = sbx.exec("python3 --version", None).await?;
println!("{}", result.stdout);

sbx.filesystem.write("/workspace/app.py", "print('hello')").await?;
let content = sbx.filesystem.read("/workspace/app.py").await?;
let files = sbx.filesystem.list(Some("/workspace")).await?;

let py = sbx.interpreter.run("print(sum(range(100)))", Some("python")).await?;
println!("{}", py.output);

let mut vars = std::collections::HashMap::new();
vars.insert("API_KEY".into(), "sk-123".into());
sbx.env.set(vars).await?;

sbx.git.clone_repo("https://github.com/user/repo.git", None).await?;
let status = sbx.git.status(None).await?;

let mut stream = sbx.exec_stream("ls -la");
while let Some(Ok(chunk)) = stream.next().await {
    println!("[{}] {}", chunk.r#type, chunk.data);
}

let snap = sbx.snapshot(None).await?;
sbx.restore(&snap.id).await?;

sbx.pause().await?;
sbx.resume().await?;
sbx.kill().await?;
```

### Configuration

```typescript
const sbx = await createSandbox({
  image: "node:22-slim",
  name: "my-sandbox",
  timeout: 7200,       // TTL in seconds (default: 3600)
  memory: 1024,        // MB (default: 512, max: 4096)
  cpu: 2,              // cores (default: 1, max: 4)
  network: true,       // enable networking (default: false)
  env: { NODE_ENV: "production" },
  workdir: "/app",
  template: "node-web", // create from template
  baseUrl: "http://localhost:3111",
  token: "your-auth-token",
})
```

## CLI

```bash
# Create
iii-sandbox create python:3.12-slim --name my-sandbox --memory 1024

# Execute
iii-sandbox exec sbx_abc123 "echo hello"
iii-sandbox exec sbx_abc123 "python3 train.py" --stream

# Code interpreter
iii-sandbox run sbx_abc123 "print(42)" --language python

# Files
iii-sandbox file write sbx_abc123 /workspace/app.py "print('hi')"
iii-sandbox file read sbx_abc123 /workspace/app.py
iii-sandbox file ls sbx_abc123 /workspace
iii-sandbox file upload sbx_abc123 ./local.tar.gz /workspace/data.tar.gz

# Manage
iii-sandbox list
iii-sandbox logs sbx_abc123
iii-sandbox kill sbx_abc123

# Start engine worker
iii-sandbox serve --port 3111
```

Environment variables: `III_SANDBOX_URL` (default `http://localhost:3111`), `III_SANDBOX_TOKEN`

## MCP Server

Connect any AI agent (Claude, Cursor, etc.) to sandboxes via Model Context Protocol.

```json
{
  "mcpServers": {
    "iii-sandbox": {
      "command": "npx",
      "args": ["@iii-sandbox/mcp"],
      "env": {
        "III_SANDBOX_URL": "http://localhost:3111"
      }
    }
  }
}
```

**39 MCP Tools**:

| Category | Tools |
|----------|-------|
| Sandbox | `sandbox_create`, `sandbox_list`, `sandbox_kill`, `sandbox_clone`, `sandbox_metrics` |
| Execution | `sandbox_exec`, `sandbox_run_code`, `sandbox_exec_queue`, `sandbox_queue_status` |
| Filesystem | `sandbox_read_file`, `sandbox_write_file`, `sandbox_list_files`, `sandbox_install_package` |
| Environment | `sandbox_env_get`, `sandbox_env_set`, `sandbox_env_list` |
| Git | `sandbox_git_clone`, `sandbox_git_status`, `sandbox_git_commit`, `sandbox_git_diff` |
| Process | `sandbox_process_list`, `sandbox_process_kill` |
| Snapshots | `sandbox_snapshot_create`, `sandbox_snapshot_restore`, `sandbox_snapshot_list` |
| Templates | `sandbox_template_list` |
| Ports | `sandbox_port_expose`, `sandbox_port_list` |
| Events | `sandbox_events_history`, `sandbox_events_publish` |
| Streams | `sandbox_stream_logs` |
| Observability | `sandbox_traces`, `sandbox_metrics_dashboard` |
| Monitoring | `sandbox_set_alert`, `sandbox_alert_history` |
| Networking | `sandbox_network_create`, `sandbox_network_connect` |
| Volumes | `sandbox_volume_create`, `sandbox_volume_attach` |

## API Reference

### Sandbox Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes` | Create sandbox |
| `GET` | `/sandbox/sandboxes` | List sandboxes |
| `GET` | `/sandbox/sandboxes/:id` | Get sandbox |
| `DELETE` | `/sandbox/sandboxes/:id` | Kill sandbox |
| `POST` | `/sandbox/sandboxes/:id/pause` | Pause (checkpoint) |
| `POST` | `/sandbox/sandboxes/:id/resume` | Resume |
| `POST` | `/sandbox/sandboxes/:id/renew` | Extend TTL |
| `POST` | `/sandbox/sandboxes/:id/clone` | Clone sandbox |

### Command Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/exec` | Run command (blocking) |
| `POST` | `/sandbox/sandboxes/:id/exec/stream` | Stream output (SSE) |
| `POST` | `/sandbox/sandboxes/:id/exec/background` | Run in background |
| `GET` | `/sandbox/exec/background/:id/status` | Background status |
| `GET` | `/sandbox/exec/background/:id/logs` | Background logs (cursor-based) |
| `POST` | `/sandbox/sandboxes/:id/exec/interrupt` | Send SIGINT |
| `POST` | `/sandbox/sandboxes/:id/exec/queue` | Queue for async execution |
| `GET` | `/sandbox/queue/:jobId/status` | Queue job status |
| `POST` | `/sandbox/queue/:jobId/cancel` | Cancel queued job |
| `GET` | `/sandbox/queue/dlq` | Dead letter queue |

### Filesystem

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/files/read` | Read file |
| `POST` | `/sandbox/sandboxes/:id/files/write` | Write file |
| `POST` | `/sandbox/sandboxes/:id/files/delete` | Delete file |
| `POST` | `/sandbox/sandboxes/:id/files/list` | List directory |
| `POST` | `/sandbox/sandboxes/:id/files/search` | Find files by glob |
| `POST` | `/sandbox/sandboxes/:id/files/upload` | Upload (base64) |
| `POST` | `/sandbox/sandboxes/:id/files/download` | Download (base64) |
| `POST` | `/sandbox/sandboxes/:id/files/info` | File metadata (stat) |
| `POST` | `/sandbox/sandboxes/:id/files/move` | Move/rename files |
| `POST` | `/sandbox/sandboxes/:id/files/mkdir` | Create directories |
| `POST` | `/sandbox/sandboxes/:id/files/rmdir` | Remove directories |
| `POST` | `/sandbox/sandboxes/:id/files/chmod` | Change permissions |

### Environment Variables

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/env/get` | Get env variable |
| `POST` | `/sandbox/sandboxes/:id/env` | Set env variables |
| `GET` | `/sandbox/sandboxes/:id/env` | List all env variables |
| `POST` | `/sandbox/sandboxes/:id/env/delete` | Delete env variable |

### Git Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/git/clone` | Clone repository |
| `GET` | `/sandbox/sandboxes/:id/git/status` | Git status |
| `POST` | `/sandbox/sandboxes/:id/git/commit` | Create commit |
| `GET` | `/sandbox/sandboxes/:id/git/diff` | Show diff |
| `GET` | `/sandbox/sandboxes/:id/git/log` | Commit log |
| `POST` | `/sandbox/sandboxes/:id/git/branch` | Create/list branches |
| `POST` | `/sandbox/sandboxes/:id/git/checkout` | Switch branch |
| `POST` | `/sandbox/sandboxes/:id/git/push` | Push changes |
| `POST` | `/sandbox/sandboxes/:id/git/pull` | Pull changes |

### Process Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/sandboxes/:id/processes` | List processes |
| `POST` | `/sandbox/sandboxes/:id/processes/kill` | Kill process |
| `GET` | `/sandbox/sandboxes/:id/processes/top` | Process top |

### Snapshots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/snapshots` | Create snapshot |
| `GET` | `/sandbox/sandboxes/:id/snapshots` | List snapshots |
| `POST` | `/sandbox/sandboxes/:id/snapshots/restore` | Restore from snapshot |
| `POST` | `/sandbox/snapshots/:snapshotId/clone` | Clone sandbox from snapshot |
| `DELETE` | `/sandbox/snapshots/:snapshotId` | Delete snapshot |

### Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/templates` | Create template |
| `GET` | `/sandbox/templates` | List templates |
| `GET` | `/sandbox/templates/:id` | Get template |
| `DELETE` | `/sandbox/templates/:id` | Delete template |

### Port Forwarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/ports` | Expose port |
| `GET` | `/sandbox/sandboxes/:id/ports` | List exposed ports |
| `DELETE` | `/sandbox/sandboxes/:id/ports` | Unexpose port |

### Interactive Terminal

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/terminal` | Create terminal session (PTY via iii channels) |
| `POST` | `/sandbox/sandboxes/:id/terminal/:sessionId/resize` | Resize terminal |
| `DELETE` | `/sandbox/sandboxes/:id/terminal/:sessionId` | Close terminal session |

### HTTP Proxy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/proxy/:id/:port` | Forward HTTP request to container port |
| `POST` | `/sandbox/sandboxes/:id/proxy/config` | Get/set proxy config (CORS, auth, timeout) |

### Code Interpreter

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/interpret/execute` | Run code |
| `POST` | `/sandbox/sandboxes/:id/interpret/install` | Install packages |
| `GET` | `/sandbox/sandboxes/:id/interpret/kernels` | List languages |

### Metrics & Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/sandboxes/:id/metrics` | Sandbox CPU/memory/network/PIDs |
| `GET` | `/sandbox/metrics` | Global system metrics |
| `GET` | `/sandbox/health` | Health check |

### Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/events/history` | Event history |
| `POST` | `/sandbox/events/publish` | Publish event |

### Observability

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/observability/traces` | Function execution traces |
| `GET` | `/sandbox/observability/metrics` | Aggregated metrics dashboard |
| `POST` | `/sandbox/observability/clear` | Clear trace data |

### Streaming

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/sandboxes/:id/stream/logs` | Stream container logs (SSE) |
| `GET` | `/sandbox/sandboxes/:id/stream/metrics` | Stream metrics (SSE) |
| `GET` | `/sandbox/stream/events` | Stream events (SSE) |

### Resource Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/alerts` | Set resource alert |
| `GET` | `/sandbox/sandboxes/:id/alerts` | List alerts |
| `DELETE` | `/sandbox/alerts/:alertId` | Delete alert |
| `GET` | `/sandbox/sandboxes/:id/alerts/history` | Alert event history |

### Networks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/networks` | Create Docker network |
| `GET` | `/sandbox/networks` | List networks |
| `POST` | `/sandbox/networks/:networkId/connect` | Connect sandbox |
| `POST` | `/sandbox/networks/:networkId/disconnect` | Disconnect sandbox |
| `DELETE` | `/sandbox/networks/:networkId` | Delete network |

### Volumes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/volumes` | Create persistent volume |
| `GET` | `/sandbox/volumes` | List volumes |
| `DELETE` | `/sandbox/volumes/:volumeId` | Delete volume |
| `POST` | `/sandbox/volumes/:volumeId/attach` | Attach to sandbox |
| `POST` | `/sandbox/volumes/:volumeId/detach` | Detach from sandbox |

### Worker Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/workers` | List all workers (alive/dead counts) |
| `POST` | `/sandbox/workers/select` | Select least-loaded worker |
| `POST` | `/sandbox/workers/reap` | Clean up dead workers |
| `POST` | `/sandbox/workers/migrate` | Backfill worker ownership |
| `POST` | `/sandbox/admin/sweep` | Trigger TTL sweep |

## Worker Architecture

The worker registers **107 iii-engine functions** across 24 modules. Compiles to a **6.6 MB release binary** with a pluggable `SandboxRuntime` trait (Docker default, Firecracker stub):

```
functions/
├── sandbox.rs       7 functions   Sandbox CRUD + pause/resume/renew
├── command.rs       2 functions   exec + exec/stream (real SSE)
├── filesystem.rs   12 functions   Full filesystem operations
├── interpreter.rs   3 functions   Multi-language code execution
├── background.rs    4 functions   Background tasks + interrupt
├── metrics.rs       2 functions   Per-sandbox + global metrics
├── env.rs           4 functions   Environment variable management
├── git.rs           9 functions   Clone, status, commit, diff, log, branch, checkout, push, pull
├── process.rs       3 functions   Process list, kill, top
├── template.rs      4 functions   Template CRUD
├── snapshot.rs      6 functions   Create, restore, list, delete, get-owner, clone
├── port.rs          3 functions   Port expose, list, unexpose
├── clone.rs         1 function    Clone sandbox with state
├── event.rs         4 functions   Event publish, subscribe, history, stream
├── queue.rs         5 functions   Async exec queue with DLQ + retries
├── network.rs       5 functions   Docker network management
├── observability.rs 4 functions   Traces, metrics, clear
├── stream.rs        3 functions   Real-time log/metrics/event streaming (SSE)
├── monitor.rs       5 functions   Resource alerts with auto-actions
├── volume.rs        5 functions   Persistent volume management
├── terminal.rs      3 functions   Interactive PTY sessions via iii channels
├── proxy.rs         2 functions   HTTP proxy with exec-based fallback
├── warmpool.rs      4 functions   Pre-warmed container pool management
└── worker.rs        6 functions   Multi-worker scaling, routing, reaper
```

**3 trigger types** (104 total):
- **HTTP** — 93 REST endpoints on port 3111
- **Cron** — TTL sweep (30s), worker heartbeat (10s), dead worker reaper (60s)
- **Queue** — 8 event subscribers for `sandbox.created`, `sandbox.killed`, `sandbox.expired` and more

**State** is managed through iii-engine's built-in KV store (file-backed by default):
- `sandbox` — sandbox metadata and config
- `background` — background exec tracking
- `global` — counters and uptime
- `snapshots` — snapshot metadata
- `templates` — template presets
- `queue` — execution queue jobs
- `networks` — Docker network mappings
- `volumes` — persistent volume tracking
- `alerts` — resource alert configurations
- `events` — event history
- `traces` — observability traces
- `metrics` — aggregated metrics
- `terminal` — interactive terminal sessions
- `pool` — warm pool container tracking
- `workers` — multi-worker registration and liveness

## Security

Each sandbox container runs with:
- **No new privileges** (`no-new-privileges` security option)
- **Dropped capabilities**: `NET_RAW`, `SYS_ADMIN`, `MKNOD`
- **PID limit**: 256 processes per sandbox
- **Network isolation**: disabled by default (`NetworkMode: none`)
- **Resource limits**: configurable memory (64-4096 MB) and CPU (0.5-4 cores)

Input validation:
- **Path traversal prevention** — all file paths are normalized and checked against the workspace root
- **Image whitelist** — configurable allowed image patterns (`III_ALLOWED_IMAGES`)
- **Command wrapping** — all commands execute inside `sh -c` with no host access
- **Env key validation** — environment variable keys must match `[A-Za-z_][A-Za-z0-9_]*` (prevents command injection)
- **Auth** — optional Bearer token authentication (`III_AUTH_TOKEN`)
- **Shell injection prevention** — args quoted and sanitized for git, chmod, and search operations
- **Terminal shell allowlist** — only `/bin/sh`, `/bin/bash`, `/bin/zsh`, `/bin/ash` allowed
- **Proxy injection prevention** — exec-based proxy uses argv (no shell), `--data-raw`, `--globoff`
- **Output capping** — stdout/stderr limited to prevent memory exhaustion
- **Rate limiting** — per-token request limits (configurable via `III_RATE_LIMIT_ENABLED`)

## Multi-Worker Scaling

Multiple worker instances can run concurrently, each managing its own set of sandboxes. The engine handles automatic load balancing and fault tolerance:

```
  Worker A (us-east)          Worker B (eu-west)
  ┌──────────────────┐        ┌──────────────────┐
  │ sbx_01, sbx_02   │        │ sbx_03, sbx_04   │
  │ heartbeat: 10s   │        │ heartbeat: 10s   │
  └────────┬─────────┘        └────────┬─────────┘
           └──────────┬───────────────┘
                      ▼
           ┌────────────────────┐
           │    iii-engine KV   │
           │  workers scope     │
           │  sandbox routing   │
           └────────────────────┘
```

- **Heartbeat**: Each worker reports liveness every 10 seconds
- **Selection**: `worker::select` picks the least-loaded worker for new sandboxes
- **Routing**: Sandbox-scoped API calls are automatically forwarded to the owning worker
- **Reaper**: Dead workers (no heartbeat for 30s) are cleaned up, orphaned sandboxes reassigned
- **Ownership**: Each sandbox tracks its `worker_id` for cross-worker routing

## Pluggable Runtime

The `SandboxRuntime` trait (29 methods) abstracts the container backend, allowing different isolation technologies:

| Backend | Status | Crate | Feature Flag |
|---------|--------|-------|--------------|
| Docker | Production | `bollard` | default |
| Firecracker | Stub | — | `firecracker` |

The runtime is selected via `III_ISOLATION_BACKEND` environment variable. The trait covers sandbox lifecycle, exec, filesystem, networking, volumes, and snapshotting.

## Supported Languages

| Language | Kernel | Package Manager | Image |
|----------|--------|-----------------|-------|
| Python | `python3` | `pip` | `python:3.12-slim` |
| JavaScript | `node` | `npm` | `node:22-slim` |
| TypeScript | `tsx` | `npm` | `node:22-slim` |
| Go | `go run` | `go install` | `golang:1.22` |
| Bash | `bash` | `apt-get` | any Linux image |

## Configuration

### iii-engine config (`iii-config.yaml`)

```yaml
modules:
  - type: StateModule
    config:
      adapter: !FileBased
        path: ./data/state_store.db
  - type: RestApiModule
    config:
      port: 3111
      host: "127.0.0.1"
  - type: QueueModule
    config:
      adapter: !Builtin {}
  - type: CronModule
    config:
      adapter: !KvCron {}
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `III_ENGINE_URL` | `ws://localhost:49134` | iii-engine WebSocket |
| `III_WORKER_NAME` | `iii-sandbox-{host}-{uuid}` | Worker name (auto-generated if unset) |
| `III_REST_PORT` | `3111` | REST API port |
| `III_API_PREFIX` | `sandbox` | API path prefix |
| `III_AUTH_TOKEN` | — | Bearer auth token |
| `III_MAX_SANDBOXES` | `50` | Max concurrent sandboxes |
| `III_DEFAULT_TIMEOUT` | `3600` | Sandbox TTL (seconds) |
| `III_DEFAULT_MEMORY` | `512` | Memory limit (MB) |
| `III_DEFAULT_CPU` | `1` | CPU limit (cores) |
| `III_ALLOWED_IMAGES` | `*` | Allowed Docker images (comma-separated) |
| `III_WORKSPACE_DIR` | `/workspace` | Container working directory |
| `III_MAX_CMD_TIMEOUT` | `300` | Max command timeout (seconds) |
| `III_POOL_SIZE` | `0` | Warm pool size (pre-warmed containers) |
| `III_ISOLATION_BACKEND` | `docker` | Isolation backend (`docker` or `firecracker`) |
| `III_RATE_LIMIT_ENABLED` | `false` | Enable per-token rate limiting |

## Repository Layout

```
iii-sandbox/
├── packages/
│   ├── worker/           Rust worker binary (107 functions, 6.6 MB release)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs       Entry point: init + runtime selection
│   │       ├── config.rs     EngineConfig from env vars
│   │       ├── docker.rs     bollard wrapper (containers, exec, stats)
│   │       ├── state.rs      KV wrapper over trigger("state::*")
│   │       ├── auth.rs       Token validation + path/command security
│   │       ├── types.rs      All domain types (Sandbox, ExecResult, etc.)
│   │       ├── functions/    24 modules — 107 registered functions
│   │       ├── triggers/     HTTP (93), cron (3), queue (8) triggers
│   │       ├── runtime/      SandboxRuntime trait + Docker/Firecracker impls
│   │       └── lifecycle/    TTL sweep, health check, graceful shutdown
│   ├── sdk/              TypeScript client library (zero-dep)
│   │   └── src/              18 modules (client, sandbox, 16 managers)
│   ├── sdk-python/       Python client library (httpx + pydantic)
│   │   ├── src/iii_sandbox/  17 modules (client, sandbox, types, 14 managers)
│   │   └── tests/            13 test files (150 tests)
│   ├── sdk-rust/         Rust client library (reqwest + serde)
│   │   └── src/              19 modules (client, sandbox, types, error, 15 managers)
│   ├── cli/              Command-line interface
│   │   └── src/
│   │       ├── index.ts      CLI router (cac)
│   │       └── commands/     9 command handlers
│   └── mcp/              MCP server (39 AI tools)
│       └── src/
│           ├── server.ts     Tool registration
│           └── tools.ts      Zod schemas
├── test/                 ~293 TypeScript SDK/CLI/MCP tests across 33 files
├── examples/             Runnable examples
└── iii-config.yaml       Engine configuration
```

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
cd packages/worker && cargo run   # Start Rust engine
pnpm test             # Run TypeScript SDK/CLI/MCP tests (~293)
pnpm lint             # TypeScript type checking

cd packages/worker && cargo test                          # Rust engine tests (333)
cd packages/sdk-python && pip install -e ".[dev]" && pytest    # Python SDK tests (150)
cd packages/sdk-rust && cargo test                             # Rust SDK tests (32)

cd test/cross-sdk && python run-python.py                      # Cross-SDK integration tests
cd test/cross-sdk && npx tsx run-ts.ts                         # (requires running engine)
cd test/cross-sdk && cargo run                                 # Rust cross-SDK runner
```

### Test Suite

**~808 total tests** across TypeScript, Python, and Rust:

| Language | Files | Tests | Tool |
|----------|-------|-------|------|
| TypeScript (SDK/CLI/MCP) | 33 | ~293 | vitest |
| Python SDK | 13 | 150 | pytest + respx |
| Rust SDK | 11 | 32 | cargo test + mockito |
| Rust engine | 24 modules | 333 | cargo test |

## License

Apache-2.0
