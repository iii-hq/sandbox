# Infrastructure Plan: Dockerfile + Docker Compose + CI/CD

## 1. Worker Dockerfile

Build the Rust worker as a minimal container.

The Dockerfile lives at `packages/worker/Dockerfile` and is built with
context set to `./packages/worker` (both by Compose and CI).

```dockerfile
# Build stage
FROM rust:1.82-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY . .
RUN cargo build --release

# Runtime stage
FROM alpine:3.20
RUN apk add --no-cache ca-certificates docker-cli
COPY --from=builder /build/target/release/iii-sandbox-worker /usr/local/bin/
EXPOSE 3111
ENTRYPOINT ["iii-sandbox-worker"]
```

Key decisions:
- Build context is `./packages/worker` — `COPY . .` copies Cargo.toml + src/ into /build
- Compose (`build: ./packages/worker`) and CI (`context: ./packages/worker`, `file: Dockerfile`) use the same context
- Alpine for smallest image (~20MB runtime)
- `docker-cli` needed since worker talks to Docker daemon via bollard (socket mount)
- No Docker-in-Docker; mount host socket: `-v /var/run/docker.sock:/var/run/docker.sock`

## 2. Docker Compose (dev + prod)

```yaml
# docker-compose.yml
services:
  iii-engine:
    image: ghcr.io/iii-hq/engine:latest
    ports: ["49134:49134"]

  worker:
    build: ./packages/worker
    depends_on: [iii-engine]
    environment:
      III_ENGINE_URL: ws://iii-engine:49134
      III_SANDBOX_TOKEN: ${III_SANDBOX_TOKEN}
      MAX_SANDBOXES: 50
      DEFAULT_MEMORY_MB: 512
      DEFAULT_TTL_SECONDS: 3600
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports: ["3111:3111"]
    restart: unless-stopped

  code-interpreter:
    build: ./images/code-interpreter
    profiles: ["interpreter"]
```

## 3. GitHub Actions CI/CD

### ci.yml — Runs on every PR
```yaml
name: CI
on: [pull_request]
jobs:
  rust-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo check --manifest-path packages/worker/Cargo.toml
      - run: cargo test --manifest-path packages/worker/Cargo.toml
      - run: cargo clippy --manifest-path packages/worker/Cargo.toml -- -D warnings

  ts-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
```

### release.yml — On tag push
```yaml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: ./packages/worker
          file: packages/worker/Dockerfile
          push: true
          tags: ghcr.io/iii-hq/sandbox-worker:${{ github.ref_name }}
          platforms: linux/amd64,linux/arm64

  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install && pnpm build
      - run: pnpm -r publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Files to Create

| File | Purpose |
|------|---------|
| `packages/worker/Dockerfile` | Multi-stage Rust build |
| `docker-compose.yml` | Dev/prod orchestration |
| `.github/workflows/ci.yml` | PR checks (Rust + TS) |
| `.github/workflows/release.yml` | Tag-based Docker + npm publish |
| `.dockerignore` | Exclude target/, node_modules/ |
