# Testing Plan: Integration Tests + Rust Unit Tests

## Problem

- 33 test files exist but all are TypeScript SDK tests (mock-based)
- No Rust unit tests for the worker (except state.rs)
- No end-to-end tests that actually spin up containers
- No CI runs tests automatically

## 1. Rust Unit Tests

Add `#[cfg(test)]` modules to every worker source file.

### Priority Files

| File | Tests Needed |
|------|-------------|
| `auth.rs` | Valid token, invalid token, empty token, timing-safe comparison |
| `config.rs` | Default values, env overrides, validation |
| `docker.rs` | Container name formatting, stats parsing, image name validation |
| `types.rs` | Serialization round-trips for all types |
| `state.rs` | Already has tests (keep as reference) |
| `ratelimit.rs` | Bucket fill, drain, burst, expiry |

### Example: auth.rs tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_token_passes() {
        std::env::set_var("III_SANDBOX_TOKEN", "test-token-123");
        assert!(check_auth("test-token-123").is_ok());
    }

    #[test]
    fn invalid_token_fails() {
        std::env::set_var("III_SANDBOX_TOKEN", "correct-token");
        assert!(check_auth("wrong-token").is_err());
    }

    #[test]
    fn empty_token_fails() {
        std::env::set_var("III_SANDBOX_TOKEN", "some-token");
        assert!(check_auth("").is_err());
    }
}
```

### Run

```bash
cd packages/worker && cargo test
```

## 2. Integration Tests (Live Docker)

End-to-end tests that create real containers. Run in CI with Docker available.

### New directory: `packages/worker/tests/`

```
packages/worker/tests/
├── common.rs          # Test helpers (create sandbox, cleanup)
├── sandbox_test.rs    # Create, get, list, kill, pause, resume
├── exec_test.rs       # Run commands, background processes
├── filesystem_test.rs # Read, write, delete, upload, download
├── git_test.rs        # Clone repo, status, commit
├── snapshot_test.rs   # Create snapshot, restore, delete
├── network_test.rs    # Create network, connect, disconnect
├── monitor_test.rs    # Set alert, check, history
└── queue_test.rs      # Submit job, check status, cancel
```

### Test Helper

```rust
// tests/common.rs
pub struct TestContext {
    pub client: reqwest::Client,
    pub base_url: String,
    pub token: String,
}

impl TestContext {
    pub async fn create_sandbox(&self) -> String {
        let res = self.client.post(&format!("{}/sandbox/sandboxes", self.base_url))
            .bearer_auth(&self.token)
            .json(&json!({ "image": "ubuntu:22.04" }))
            .send().await.unwrap();
        let body: Value = res.json().await.unwrap();
        body["id"].as_str().unwrap().to_string()
    }

    pub async fn cleanup(&self, id: &str) {
        let _ = self.client.delete(&format!("{}/sandbox/sandboxes/{}", self.base_url, id))
            .bearer_auth(&self.token)
            .send().await;
    }
}
```

### CI Integration

```yaml
integration-test:
  runs-on: ubuntu-latest
  services:
    iii-engine:
      image: ghcr.io/iii-hq/engine:latest
      ports: ["49134:49134"]
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - run: cargo build --release --manifest-path packages/worker/Cargo.toml
    - run: |
        III_ENGINE_URL=ws://localhost:49134 \
        ./packages/worker/target/release/iii-sandbox-worker &
        sleep 3
        cargo test --manifest-path packages/worker/Cargo.toml --test '*'
```

## 3. SDK Cross-Language Tests

Verify all 3 SDKs produce identical results against the same worker.

```
test/cross-sdk/
├── scenario.json       # Shared test scenarios
├── run-ts.ts           # TypeScript runner
├── run-python.py       # Python runner
└── run-rust.rs         # Rust runner
```

Each runner executes the same operations and asserts the same results.

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/worker/src/auth.rs` | MODIFY — add #[cfg(test)] |
| `packages/worker/src/config.rs` | MODIFY — add #[cfg(test)] |
| `packages/worker/src/docker.rs` | MODIFY — add #[cfg(test)] |
| `packages/worker/src/types.rs` | MODIFY — add #[cfg(test)] |
| `packages/worker/tests/*.rs` | CREATE — 9 integration test files |
| `test/cross-sdk/` | CREATE — cross-language test suite |
| `.github/workflows/ci.yml` | MODIFY — add integration test job |
