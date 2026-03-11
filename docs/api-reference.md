# API Reference

Base URL: `http://localhost:3111`

All endpoints require `Authorization: Bearer <token>` when `III_AUTH_TOKEN` is set.

## Sandbox Lifecycle

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

## Command Execution

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

## Filesystem

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

## Environment Variables

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/env/get` | Get env variable |
| `POST` | `/sandbox/sandboxes/:id/env` | Set env variables |
| `GET` | `/sandbox/sandboxes/:id/env` | List all env variables |
| `POST` | `/sandbox/sandboxes/:id/env/delete` | Delete env variable |

## Git Operations

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

## Process Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/sandboxes/:id/processes` | List processes |
| `POST` | `/sandbox/sandboxes/:id/processes/kill` | Kill process |
| `GET` | `/sandbox/sandboxes/:id/processes/top` | Process top |

## Snapshots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/snapshots` | Create snapshot |
| `GET` | `/sandbox/sandboxes/:id/snapshots` | List snapshots |
| `POST` | `/sandbox/sandboxes/:id/snapshots/restore` | Restore from snapshot |
| `POST` | `/sandbox/snapshots/:snapshotId/clone` | Clone sandbox from snapshot |
| `DELETE` | `/sandbox/snapshots/:snapshotId` | Delete snapshot |

## Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/templates` | Create template |
| `GET` | `/sandbox/templates` | List templates |
| `GET` | `/sandbox/templates/:id` | Get template |
| `DELETE` | `/sandbox/templates/:id` | Delete template |

## Port Forwarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/ports` | Expose port |
| `GET` | `/sandbox/sandboxes/:id/ports` | List exposed ports |
| `DELETE` | `/sandbox/sandboxes/:id/ports` | Unexpose port |

## Interactive Terminal

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/terminal` | Create terminal session (PTY via iii channels) |
| `POST` | `/sandbox/sandboxes/:id/terminal/:sessionId/resize` | Resize terminal |
| `DELETE` | `/sandbox/sandboxes/:id/terminal/:sessionId` | Close terminal session |

## HTTP Proxy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/proxy/:id/:port` | Forward HTTP request to container port |
| `POST` | `/sandbox/sandboxes/:id/proxy/config` | Get/set proxy config (CORS, auth, timeout) |

## Code Interpreter

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/interpret/execute` | Run code |
| `POST` | `/sandbox/sandboxes/:id/interpret/install` | Install packages |
| `GET` | `/sandbox/sandboxes/:id/interpret/kernels` | List languages |

## Metrics & Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/sandboxes/:id/metrics` | Sandbox CPU/memory/network/PIDs |
| `GET` | `/sandbox/metrics` | Global system metrics |
| `GET` | `/sandbox/health` | Health check |

## Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/events/history` | Event history |
| `POST` | `/sandbox/events/publish` | Publish event |

## Observability

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/observability/traces` | Function execution traces |
| `GET` | `/sandbox/observability/metrics` | Aggregated metrics dashboard |
| `POST` | `/sandbox/observability/clear` | Clear trace data |

## Streaming (SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/sandboxes/:id/stream/logs` | Stream container logs |
| `GET` | `/sandbox/sandboxes/:id/stream/metrics` | Stream metrics |
| `GET` | `/sandbox/stream/events` | Stream events |

## Resource Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/sandboxes/:id/alerts` | Set resource alert |
| `GET` | `/sandbox/sandboxes/:id/alerts` | List alerts |
| `DELETE` | `/sandbox/alerts/:alertId` | Delete alert |
| `GET` | `/sandbox/sandboxes/:id/alerts/history` | Alert event history |

## Networks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/networks` | Create Docker network |
| `GET` | `/sandbox/networks` | List networks |
| `POST` | `/sandbox/networks/:networkId/connect` | Connect sandbox |
| `POST` | `/sandbox/networks/:networkId/disconnect` | Disconnect sandbox |
| `DELETE` | `/sandbox/networks/:networkId` | Delete network |

## Volumes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sandbox/volumes` | Create persistent volume |
| `GET` | `/sandbox/volumes` | List volumes |
| `DELETE` | `/sandbox/volumes/:volumeId` | Delete volume |
| `POST` | `/sandbox/volumes/:volumeId/attach` | Attach to sandbox |
| `POST` | `/sandbox/volumes/:volumeId/detach` | Detach from sandbox |

## Worker Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sandbox/workers` | List all workers |
| `POST` | `/sandbox/workers/select` | Select least-loaded worker |
| `POST` | `/sandbox/workers/reap` | Clean up dead workers |
| `POST` | `/sandbox/workers/migrate` | Backfill worker ownership |
| `POST` | `/sandbox/admin/sweep` | Trigger TTL sweep |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `III_ENGINE_URL` | `ws://localhost:49134` | iii-engine WebSocket |
| `III_WORKER_NAME` | auto-generated | Worker name |
| `III_REST_PORT` | `3111` | REST API port |
| `III_API_PREFIX` | `sandbox` | API path prefix |
| `III_AUTH_TOKEN` | -- | Bearer auth token |
| `III_MAX_SANDBOXES` | `50` | Max concurrent sandboxes |
| `III_DEFAULT_TIMEOUT` | `3600` | Sandbox TTL (seconds) |
| `III_DEFAULT_MEMORY` | `512` | Memory limit (MB) |
| `III_DEFAULT_CPU` | `1` | CPU limit (cores) |
| `III_ALLOWED_IMAGES` | `*` | Allowed Docker images (comma-separated) |
| `III_WORKSPACE_DIR` | `/workspace` | Container working directory |
| `III_MAX_CMD_TIMEOUT` | `300` | Max command timeout (seconds) |
| `III_POOL_SIZE` | `0` | Warm pool size |
| `III_ISOLATION_BACKEND` | `docker` | `docker` or `firecracker` |
| `III_RATE_LIMIT_ENABLED` | `false` | Enable per-token rate limiting |
