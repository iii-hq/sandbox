# Performance Plan: Warm Pool + Cold Start Optimization

## Problem

Current cold start: ~2-5 seconds (Docker pull + create + start).
Competitors: E2B <300ms (Firecracker), Modal <100ms (warm pool), Fly <500ms (placement).

## Solution: Pre-warmed Container Pool

Maintain a pool of pre-created, stopped containers ready to start instantly.

### Architecture

The pool keys containers by a **canonical profile** (not just image) since
runtime config (memory, cpu, network) is baked at container creation time.
Only containers matching the full profile can be reused.

```
PoolProfile {
    image: String,
    memory_mb: u64,
    cpu: f64,
    network_enabled: bool,
}

WarmPool {
    pool_size: usize,          // target pool size per profile (default: 5)
    profiles: Vec<PoolProfile>,  // profiles to pre-warm
    containers: HashMap<PoolProfile, Vec<String>>,  // profile -> [container_ids]
    replenish_interval: Duration,  // check every 30s
}
```

A `PoolProfile` is derived from the incoming `sandbox::create` request using
the same fields that `validate_sandbox_config()` in auth.rs produces. Fields
like `env`, `workdir`, `entrypoint`, and `labels` are NOT part of the pool key
because they can be set at start time via `docker.update_container()` or
environment injection. Only fields that are immutable after container creation
(image, memory limit, cpu shares, network mode) participate in matching.

If the incoming request's profile doesn't match any pre-warmed profile, the
pool is skipped and a fresh container is created normally.

### Flow

1. **On startup**: Pre-create `pool_size` stopped containers per configured profile
2. **On sandbox::create**: Derive `PoolProfile` from request, look up pool
3. **On match**: `docker.start_container()` only (~200ms vs ~2-5s)
4. **On miss**: Fall back to normal create path (~2-5s)
5. **Background replenish**: Cron trigger every 30s refills pool to target size
6. **On shutdown**: Clean up all pool containers

### Implementation

New file: `packages/worker/src/functions/warmpool.rs`

```rust
pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    // warmpool::init — pre-create containers on startup
    // warmpool::acquire — pop a container from pool (called by sandbox::create)
    // warmpool::replenish — background fill (registered as cron trigger)
    // warmpool::status — pool stats
    // warmpool::resize — change pool size at runtime
}
```

### Modify sandbox::create

```rust
// Derive pool profile from validated sandbox config
let profile = json!({
    "image": image,
    "memory_mb": memory_mb,
    "cpu": cpu,
    "network_enabled": network_enabled,
});

// Before creating new container, try warm pool
if let Some(container_id) = iii.trigger("warmpool::acquire", profile).await.ok() {
    // Rename container, start it, return immediately
    docker.rename_container(&container_id, &format!("iii-sbx-{}", sandbox_id)).await?;
    docker.start_container::<String>(&container_id, None).await?;
    // ~200ms total
} else {
    // Profile not in pool or pool empty — create from scratch (~2-5s)
    docker.create_container(...).await?;
    docker.start_container(...).await?;
}
```

### Config

```yaml
warm_pool:
  enabled: true
  pool_size: 5
  replenish_interval_secs: 30
  profiles:
    - image: "ubuntu:22.04"
      memory_mb: 512
      cpu: 1.0
      network_enabled: true
    - image: "python:3.12-slim"
      memory_mb: 512
      cpu: 1.0
      network_enabled: true
    - image: "node:20-slim"
      memory_mb: 512
      cpu: 1.0
      network_enabled: true
```

### Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Cold start | 2-5s | ~200ms |
| Memory overhead | 0 | ~50MB per pooled container |
| Throughput | ~10 creates/s | ~50 creates/s |

### Trade-offs

- **Memory cost**: Each pooled container uses ~10MB even stopped
- **Profile mismatch**: Pool only helps when request matches a pre-configured profile (image + memory + cpu + network). Non-default configs always take the slow path.
- **Complexity**: Need cleanup logic for stale pool containers

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/worker/src/functions/warmpool.rs` | CREATE |
| `packages/worker/src/functions/mod.rs` | MODIFY — add warmpool |
| `packages/worker/src/functions/sandbox.rs` | MODIFY — try pool first |
| `packages/worker/src/config.rs` | MODIFY — add pool config |
| `packages/worker/src/triggers/cron.rs` | MODIFY — add replenish cron |
