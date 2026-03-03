# iii-sandbox

Secure, isolated Docker sandboxes for code execution. Built on [iii-engine](https://github.com/iii-hq/iii) primitives (Worker / Function / Trigger).

```
         ┌───────┐ ┌───────┐ ┌───────┐
         │  SDK  │ │  CLI  │ │  MCP  │
         └──┬────┘ └──┬────┘ └──┬────┘
            └─────────┼─────────┘
                      ▼
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
  ┌──────────────────────────────────────────┐
  │     Engine Worker  (iii-sdk, Node.js)    │
  │                                          │
  │  31 Functions · 31 Endpoints · 3 Triggers│
  │  sandbox · exec · filesystem · interpret │
  │  background · metrics · ttl · events     │
  └────────────────┬─────────────────────────┘
                   ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │ sbx_01 │ │ sbx_02 │ │ sbx_03 │ │ sbx_04 │
  │ python │ │  node  │ │ golang │ │  bash  │
  └────────┘ └────────┘ └────────┘ └────────┘
              Docker Containers
```

## Quick Start

**Prerequisites**: Docker, Node.js >= 20, pnpm >= 9, [iii-engine](https://github.com/iii-hq/iii) binary

```bash
# 1. Start the iii-engine
iii --config iii-config.yaml

# 2. Start the sandbox worker
pnpm dev

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
git clone https://github.com/rohitg00/iii-sandbox.git
cd iii-sandbox
pnpm install
pnpm build
```

## Packages

| Package | Description | Entry |
|---------|-------------|-------|
| `@iii-sandbox/engine` | Worker with 31 functions, Docker integration, security | `packages/engine` |
| `@iii-sandbox/sdk` | Zero-dependency client library for Node.js | `packages/sdk` |
| `@iii-sandbox/cli` | Command-line interface (11 commands) | `packages/cli` |
| `@iii-sandbox/mcp` | MCP server with 10 AI tools | `packages/mcp` |

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

**10 MCP Tools**: `sandbox_create`, `sandbox_exec`, `sandbox_run_code`, `sandbox_read_file`, `sandbox_write_file`, `sandbox_list_files`, `sandbox_install_package`, `sandbox_list`, `sandbox_kill`, `sandbox_metrics`

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

### Command Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/exec` | Run command (blocking) |
| `POST` | `/sandbox/sandboxes/:id/exec/stream` | Stream output (SSE) |
| `POST` | `/sandbox/sandboxes/:id/exec/background` | Run in background |
| `GET` | `/sandbox/exec/background/:id/status` | Background status |
| `GET` | `/sandbox/exec/background/:id/logs` | Background logs (cursor-based) |
| `POST` | `/sandbox/sandboxes/:id/exec/interrupt` | Send SIGINT |

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

## Engine Architecture

The engine registers **31 iii-engine functions** across 6 modules:

```
functions/
├── sandbox.ts      6 functions   Sandbox CRUD + pause/resume
├── command.ts      2 functions   exec + exec/stream (real SSE)
├── filesystem.ts  12 functions   Full filesystem operations
├── interpreter.ts  3 functions   Multi-language code execution
├── background.ts   4 functions   Background tasks + interrupt
└── metrics.ts      2 functions   Per-sandbox + global metrics
```

**3 trigger types**:
- **HTTP** — 31 REST endpoints on port 3111
- **Cron** — TTL sweep every 30 seconds (expires idle sandboxes)
- **Events** — `sandbox.created`, `sandbox.killed`, `sandbox.expired` queue events

**State** is managed through iii-engine's built-in KV store (file-backed by default):
- `sandbox` scope — sandbox metadata and config
- `background` scope — background exec tracking
- `global` scope — counters and uptime

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
- **Auth** — optional Bearer token authentication (`III_AUTH_TOKEN`)

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
| `III_WORKER_NAME` | `iii-sandbox` | Worker name |
| `III_REST_PORT` | `3111` | REST API port |
| `III_API_PREFIX` | `/sandbox` | API path prefix |
| `III_AUTH_TOKEN` | — | Bearer auth token |
| `III_MAX_SANDBOXES` | `50` | Max concurrent sandboxes |
| `III_DEFAULT_TIMEOUT` | `3600` | Sandbox TTL (seconds) |
| `III_DEFAULT_MEMORY` | `512` | Memory limit (MB) |
| `III_DEFAULT_CPU` | `1` | CPU limit (cores) |
| `III_ALLOWED_IMAGES` | `*` | Allowed Docker images (comma-separated) |
| `III_WORKSPACE_DIR` | `/workspace` | Container working directory |
| `III_MAX_CMD_TIMEOUT` | `300` | Max command timeout (seconds) |

## Repository Layout

```
iii-sandbox/
├── packages/
│   ├── engine/           iii-engine worker (31 functions, Docker integration)
│   │   └── src/
│   │       ├── docker/       Container management + streaming
│   │       ├── functions/    6 function modules
│   │       ├── triggers/     HTTP, cron, event triggers
│   │       ├── lifecycle/    TTL sweep + cleanup
│   │       ├── state/        KV wrapper + schema
│   │       ├── security/     Path traversal, auth, validation
│   │       └── interpreter/  Language configurations
│   ├── sdk/              Zero-dependency client library
│   │   └── src/
│   │       ├── client.ts     HTTP + SSE streaming
│   │       ├── sandbox.ts    Sandbox class
│   │       ├── filesystem.ts FileSystem class
│   │       └── interpreter.ts CodeInterpreter class
│   ├── cli/              Command-line interface
│   │   └── src/
│   │       ├── index.ts      CLI router (cac)
│   │       └── commands/     9 command handlers
│   └── mcp/              MCP server (10 AI tools)
│       └── src/
│           ├── server.ts     Tool registration
│           └── tools.ts      Zod schemas
├── test/                 543 tests across 36 files
├── examples/             Runnable examples
└── iii-config.yaml       Engine configuration
```

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm dev              # Start engine worker (dev mode)
pnpm test             # Run all 543 tests
pnpm lint             # TypeScript type checking
```

Tests are organized by package: 18 engine tests, 7 SDK tests, 7 CLI tests, 2 MCP tests, and 1 integration test (40 E2E scenarios covering sandbox lifecycle, command execution, file operations, code interpreter, pause/resume, metrics, security, and edge cases).

## License

Apache-2.0
