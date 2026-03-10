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
On any sandbox operation: check `sandbox.worker_id == self.worker_id`, if not, forward via `iii.trigger()` to correct worker.

### Load Balancing

Workers report capacity via `worker::heartbeat` (cron every 10s):
```json
{ "worker_id": "w1", "active_sandboxes": 42, "max_sandboxes": 50, "cpu_pct": 65 }
```

A `worker::select` function picks least-loaded worker for new creates.

### Files

| File | Action |
|------|--------|
| `packages/worker/src/functions/worker.rs` | CREATE — heartbeat, select, forward |
| `packages/worker/src/types.rs` | MODIFY — add worker_id to Sandbox |
| `packages/worker/src/config.rs` | MODIFY — add worker_id config |

---

## 2. Snapshot Cloning (Copy-on-Write)

### Problem

`sandbox::clone` does full container commit + create (~5-10s).
Competitors: E2B snapshots in <1s via Firecracker snapshots.

### Solution: Overlayfs Snapshots

Use Docker's `--volumes-from` and committed image layers for fast cloning.

```rust
// 1. Commit current state as image layer (~1s)
docker.commit_container(commit_opts).await?;

// 2. Create new container from committed image (~500ms)
docker.create_container(opts_from_committed_image).await?;

// 3. Start clone (~200ms)
docker.start_container(&clone_name, None).await?;
```

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

```rust
pub struct RateLimiter {
    limits: HashMap<String, TokenBucket>,
}

pub struct TokenBucket {
    capacity: u32,
    tokens: f64,
    last_refill: Instant,
    rate_per_second: f64,
}

impl RateLimiter {
    pub fn check(&mut self, key: &str) -> Result<(), RateLimitError> {
        let bucket = self.limits.entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(DEFAULT_CAPACITY, DEFAULT_RATE));
        bucket.try_consume()
    }
}
```

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

Check rate limit in `auth.rs` before dispatching any function:
```rust
pub fn check_auth_and_rate(token: &str, sandbox_id: Option<&str>) -> Result<()> {
    check_auth(token)?;
    rate_limiter.check(&format!("token:{}", token))?;
    if let Some(id) = sandbox_id {
        rate_limiter.check(&format!("sandbox:{}", id))?;
    }
    Ok(())
}
```

### Files

| File | Action |
|------|--------|
| `packages/worker/src/ratelimit.rs` | CREATE |
| `packages/worker/src/auth.rs` | MODIFY — integrate rate limiter |
| `packages/worker/src/config.rs` | MODIFY — rate limit config |
| `packages/worker/src/functions/worker.rs` | CREATE — heartbeat, routing |
