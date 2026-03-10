# iii-sandbox Master Roadmap

## Competitive Position (as of 2026-03-10)

### Strengths
- **Broadest API surface**: 84 functions, 86 HTTP endpoints (vs E2B's ~20)
- **Only sandbox with Rust SDK** (+ TypeScript + Python)
- **iii-engine primitives**: KV state, cron, events, PubSub built-in
- **Fully self-hosted**: No vendor lock-in, Apache-2.0
- **Deep Docker integration**: Git, code interpreter, volumes, networks, monitoring

### Weaknesses
- **Docker isolation only**: Shared kernel (competitors use Firecracker/gVisor)
- **2-5s cold starts**: Competitors achieve <300ms
- **Single worker**: No horizontal scaling
- **No CI/CD**: No automated tests, builds, or releases
- **No interactive terminal**: Request-response exec only
- **No HTTP proxy**: Can't access sandbox-hosted services externally

## Priority Order

| # | Plan | Impact | Effort | File |
|---|------|--------|--------|------|
| 1 | **Dockerfile + CI/CD** | Ship reliably | S | [infrastructure-plan.md](./2026-03-10-infrastructure-plan.md) |
| 2 | **Rust unit tests** | Catch regressions | S | [testing-plan.md](./2026-03-10-testing-plan.md) |
| 3 | **Warm pool** | 10x faster cold starts | M | [performance-plan.md](./2026-03-10-performance-plan.md) |
| 4 | **Rate limiting** | Production readiness | S | [scaling-plan.md](./2026-03-10-scaling-plan.md) §3 |
| 5 | **WebSocket terminal** | Interactive shells | M | [interactive-features-plan.md](./2026-03-10-interactive-features-plan.md) §1 |
| 6 | **HTTP proxy** | Access sandbox services | M | [interactive-features-plan.md](./2026-03-10-interactive-features-plan.md) §2 |
| 7 | **Multi-worker** | Horizontal scaling | L | [scaling-plan.md](./2026-03-10-scaling-plan.md) §1 |
| 8 | **Snapshot cloning** | Fast clones | M | [scaling-plan.md](./2026-03-10-scaling-plan.md) §2 |
| 9 | **Integration tests** | End-to-end confidence | M | [testing-plan.md](./2026-03-10-testing-plan.md) §2 |
| 10 | **Firecracker backend** | VM-level isolation | XL | [isolation-plan.md](./2026-03-10-isolation-plan.md) |

**S** = 1-2 days, **M** = 3-5 days, **L** = 1-2 weeks, **XL** = 2-4 weeks

## Implementation Phases

### Phase 1: Ship It (Items 1-2)
- Dockerfile for worker
- Docker Compose for dev/prod
- GitHub Actions CI (Rust check + clippy + test, TS test)
- Rust unit tests for auth, config, types, docker

### Phase 2: Go Fast (Items 3-4)
- Warm container pool with background replenish
- Token bucket rate limiter
- Per-token and per-sandbox quotas

### Phase 3: Interactive (Items 5-6)
- WebSocket terminal with PTY
- HTTP proxy for sandbox ports
- SDK additions for terminal and proxy managers

### Phase 4: Scale (Items 7-9)
- Worker heartbeat + routing
- Multi-worker function forwarding
- Overlayfs snapshot cloning
- Full integration test suite
- Cross-SDK test runner

### Phase 5: Harden (Item 10)
- SandboxRuntime trait extraction
- DockerRuntime wrapper
- FirecrackerRuntime behind feature flag
- Rootfs builder (OCI -> ext4)
