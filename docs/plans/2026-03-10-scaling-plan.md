# Scaling Plan: Multi-Worker + Snapshot Cloning + Rate Limiting

## 1. Multi-Worker Scaling

### Problem

Single worker process = single host limit. No horizontal scaling.
Competitors: E2B/Modal/Fly scale across clusters.

### Architecture

Multiple workers register with the same iii-engine. Engine routes function calls to the worker that owns the sandbox.

```
iii-engine (single coordinator)
  ├── worker-1 (host-a, sandboxes sbx_001..sbx_050)
  ├── worker-2 (host-b, sandboxes sbx_051..sbx_100)
  └── worker-3 (host-c, sandboxes sbx_101..sbx_150)
```

### Routing Strategy

Each worker registers with a `worker_id`. Sandbox state includes `worker_id` field.

```rust
let iii = III::with_metadata(
    &engine_url,
    WorkerMetadata {
        name: format!("iii-sandbox-worker-{}", hostname),
        ..
    },
).await?;
```

On `sandbox::create`: worker sets `sandbox.worker_id = self.worker_id` in KV.

#### Worker-targeted dispatch

Since all workers register the same function IDs, plain `iii.trigger("sandbox::get", ...)`
would hit any worker — not necessarily the sandbox owner. To solve this, each worker
registers worker-scoped functions using its worker_id as a namespace:

```rust
// Each worker registers its own scoped function
let fn_id = format!("worker::{}::sandbox::get", worker_id);
iii.register_function_with_description(&fn_id, "Get sandbox (worker-scoped)", handler);
```

When a request arrives at a worker that doesn't own the sandbox:
1. Look up `sandbox.worker_id` from KV
2. Check the owner worker is alive (last heartbeat < 30s ago in KV)
3. If alive: `iii.trigger(&format!("worker::{}::sandbox::get", sandbox.worker_id), payload)`
4. The engine routes to the specific worker that registered that scoped function

For `sandbox::create`, a coordinator function `worker::select` picks the
least-loaded worker, then triggers `worker::{target_id}::sandbox::create`.

#### Dead-worker recovery

If a worker's heartbeat is stale (>30s), it is considered dead. Recovery:

1. `worker::reap` (cron every 60s) scans heartbeats for stale workers
2. For each dead worker, list all sandboxes with that `worker_id`
3. Orphaned sandboxes are either:
   - **Reassigned**: A live worker claims ownership (sets `worker_id` to itself),
     re-registers scoped functions, and verifies the container still exists
   - **Marked dead**: If the container is gone, sandbox status is set to `expired`
4. The dead worker's heartbeat record is deleted from KV

This prevents forwarded calls from silently failing when the owner is down.

### Backward Compatibility

The `worker_id` field on `Sandbox` must be `Option<String>` with `#[serde(default)]`
to avoid breaking deserialization of existing KV records that lack the field:

```rust
// In types.rs — Sandbox struct
#[serde(default, skip_serializing_if = "Option::is_none")]
pub worker_id: Option<String>,
```

**Pre-scale migration is required** before starting a second worker.
A `worker::migrate-ownership` function must run once to backfill `worker_id`
for all existing sandbox records:

```rust
// worker::migrate-ownership — run once before scaling to 2+ workers
let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;
for mut sbx in sandboxes {
    if sbx.worker_id.is_none() {
        sbx.worker_id = Some(self_worker_id.clone());
        kv.set(scopes::SANDBOXES, &sbx.id, &sbx).await?;
    }
}
```

Until migration runs, multi-worker mode must not be enabled. The startup
sequence checks: if any sandbox has `worker_id: None` and the cluster has
>1 worker, refuse to start and log an error directing the operator to run
the migration first. This prevents two workers from both claiming the same
legacy sandbox.

### Load Balancing

Workers report capacity via `worker::heartbeat` (cron every 10s):
```json
{ "worker_id": "w1", "active_sandboxes": 42, "max_sandboxes": 50, "cpu_pct": 65 }
```

A `worker::select` function picks least-loaded worker for new creates.

### Files

| File | Action |
|------|--------|
| `packages/worker/src/functions/worker.rs` | CREATE — heartbeat, select, forward, scoped registration |
| `packages/worker/src/types.rs` | MODIFY — add `worker_id: Option<String>` with `#[serde(default)]` |
| `packages/worker/src/config.rs` | MODIFY — add worker_id config |
| `packages/worker/src/triggers/api.rs` | MODIFY — add routing lookup before dispatch |

---

## 2. Snapshot Cloning (Copy-on-Write)

### Problem

`sandbox::clone` does full container commit + create (~5-10s).
Competitors: E2B snapshots in <1s via Firecracker snapshots.

### Solution: Image-layer Snapshots with Isolated Writable Storage

Use committed image layers for fast cloning. Each clone gets its own
writable layer — no shared mutable state between sandboxes.

```rust
// 1. Commit current state as image layer (~1s)
docker.commit_container(commit_opts).await?;

// 2. Create new container from committed image (~500ms)
//    Docker automatically gives each container its own writable overlay layer.
//    Do NOT use --volumes-from (it shares mutable volumes, breaking isolation).
docker.create_container(opts_from_committed_image).await?;

// 3. Start clone (~200ms)
docker.start_container(&clone_name, None).await?;
```

Each clone is fully isolated: the committed image provides read-only base state,
and Docker's overlayfs gives each container its own writable layer on top.
If the source sandbox has named volumes, the clone creates new anonymous
volumes (not shared) and copies data into them during the clone step.

With warm pool: pre-create containers from popular snapshot images.

### Snapshot Registry

Store snapshots as Docker images with metadata in KV:
```json
{
    "snapshot_id": "snap_abc",
    "image_tag": "iii-snap-abc:latest",
    "sandbox_id": "sbx_123",
    "size_bytes": 52428800,
    "created_at": 1710000000
}
```

### Files

| File | Action |
|------|--------|
| `packages/worker/src/functions/snapshot.rs` | MODIFY — use image layers |

---

## 3. Rate Limiting + Tenant Isolation

### Problem

No rate limiting. Any client can exhaust all resources.
Competitors: All production platforms have per-tenant quotas.

### Architecture

Rate limiting at two levels:
1. **Per-token**: X requests/minute per API token
2. **Per-sandbox**: Y exec calls/minute per sandbox

### Implementation

New file: `packages/worker/src/ratelimit.rs`

The rate limiter must be safe to share across concurrent async handlers.
Use `Arc<Mutex<...>>` for the in-process implementation. For multi-worker
deployments, replace with a KV-backed implementation using iii-engine state.

```rust
use std::sync::{Arc, Mutex};

pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<String, TokenBucket>>>,
}

pub struct TokenBucket {
    capacity: u32,
    tokens: f64,
    last_refill: Instant,
    rate_per_second: f64,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn check(&self, key: &str) -> Result<(), RateLimitError> {
        let mut limits = self.inner.lock().unwrap();
        let bucket = limits.entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(DEFAULT_CAPACITY, DEFAULT_RATE));
        bucket.try_consume()
    }
}
```

**Single-worker**: In-process `Arc<Mutex<...>>` is sufficient. The limiter is
created once in `main.rs` and passed to `check_auth_and_rate` via shared state.

**Multi-worker**: In-process limits are per-worker only — a client can bypass
quotas by distributing requests across workers. For cluster-wide enforcement,
replace the `HashMap` with KV-backed counters via `iii.trigger("state::*", ...)`.
This trades ~1ms latency per rate check for global consistency. Alternatively,
set per-worker limits to `global_limit / num_workers` as a simpler approximation.

### Config

```yaml
rate_limits:
  enabled: true
  per_token:
    requests_per_minute: 600
    burst: 100
  per_sandbox:
    exec_per_minute: 120
    fs_ops_per_minute: 300
```

### Integration

Check rate limit in `auth.rs` before dispatching any function. The
`RateLimiter` is shared via `Arc` (cloned into each handler closure):

```rust
pub fn check_auth_and_rate(
    req: &Value,
    config: &EngineConfig,
    limiter: &RateLimiter,
    sandbox_id: Option<&str>,
) -> Option<Value> {
    if let Some(err) = check_auth(req, config) {
        return Some(err);
    }
    let token = extract_token(req);
    if let Err(_) = limiter.check(&format!("token:{}", token)) {
        return Some(json!({ "status_code": 429, "body": { "error": "Rate limit exceeded" } }));
    }
    if let Some(id) = sandbox_id {
        if let Err(_) = limiter.check(&format!("sandbox:{}", id)) {
            return Some(json!({ "status_code": 429, "body": { "error": "Rate limit exceeded" } }));
        }
    }
    None
}
```

### Files

| File | Action |
|------|--------|
| `packages/worker/src/ratelimit.rs` | CREATE |
| `packages/worker/src/auth.rs` | MODIFY — integrate rate limiter |
| `packages/worker/src/config.rs` | MODIFY — rate limit config |
| `packages/worker/src/functions/worker.rs` | CREATE — heartbeat, routing |
