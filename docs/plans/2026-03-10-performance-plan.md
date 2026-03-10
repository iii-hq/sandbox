# Performance Plan: Warm Pool + Cold Start Optimization

## Problem

Current cold start: ~2-5 seconds (Docker pull + create + start).
Competitors: E2B <300ms (Firecracker), Modal <100ms (warm pool), Fly <500ms (placement).

## Solution: Pre-warmed Container Pool

Maintain a pool of pre-created, stopped containers ready to start instantly.

### Architecture

```
WarmPool {
    pool_size: usize,          // target pool size per image (default: 5)
    images: Vec<String>,       // images to pre-warm (["ubuntu:22.04", "python:3.12"])
    containers: HashMap<String, Vec<String>>,  // image -> [container_ids]
    replenish_interval: Duration,  // check every 30s
}
```

### Flow

1. **On startup**: Pre-create `pool_size` stopped containers per image
2. **On sandbox::create**: Pop a pre-warmed container instead of creating new
3. **On pop**: `docker.start_container()` only (~200ms vs ~2-5s)
4. **Background replenish**: Cron trigger every 30s refills pool to target size
5. **On shutdown**: Clean up all pool containers

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
// Before creating new container, try warm pool
if let Some(container_id) = iii.trigger("warmpool::acquire", json!({ "image": image })).await.ok() {
    // Rename container, start it, return immediately
    docker.rename_container(&container_id, &format!("iii-sbx-{}", sandbox_id)).await?;
    docker.start_container::<String>(&container_id, None).await?;
    // ~200ms total
} else {
    // Fallback: create from scratch (~2-5s)
    docker.create_container(...).await?;
    docker.start_container(...).await?;
}
```

### Config

```yaml
warm_pool:
  enabled: true
  pool_size: 5
  images: ["ubuntu:22.04", "python:3.12-slim", "node:20-slim"]
  replenish_interval_secs: 30
```

### Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Cold start | 2-5s | ~200ms |
| Memory overhead | 0 | ~50MB per pooled container |
| Throughput | ~10 creates/s | ~50 creates/s |

### Trade-offs

- **Memory cost**: Each pooled container uses ~10MB even stopped
- **Image mismatch**: Pool only helps for pre-configured images
- **Complexity**: Need cleanup logic for stale pool containers

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/worker/src/functions/warmpool.rs` | CREATE |
| `packages/worker/src/functions/mod.rs` | MODIFY — add warmpool |
| `packages/worker/src/functions/sandbox.rs` | MODIFY — try pool first |
| `packages/worker/src/config.rs` | MODIFY — add pool config |
| `packages/worker/src/triggers/cron.rs` | MODIFY — add replenish cron |
