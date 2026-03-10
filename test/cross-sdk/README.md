# Cross-SDK Test Runner

Verifies all 3 SDKs (TypeScript, Python, Rust) produce identical results against the same iii-sandbox worker. Each runner reads from the shared `scenario.json` and executes the same HTTP calls, validating responses match expectations.

## Prerequisites

- Running iii-sandbox worker on `localhost:3111` (or set `TEST_BASE_URL`)
- Docker available (worker creates containers)
- `alpine:3.19` image pulled (`docker pull alpine:3.19`)

## Scenarios

| Name | What it tests |
|------|--------------|
| sandbox-lifecycle | Create, get, exec, pause, resume, kill |
| filesystem-roundtrip | Write, read, list, delete files |
| exec-variations | Exit codes, stderr, working directory |
| env-management | Set, get, list, delete env vars |
| snapshot-clone | Create and list snapshots |

## Running

### TypeScript

```sh
npx tsx run-ts.ts
```

### Python

```sh
pip install httpx
python run-python.py
```

### Rust

```sh
cargo run --manifest-path Cargo.toml
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_BASE_URL` | `http://localhost:3111` | Worker base URL |
| `TEST_AUTH_TOKEN` | `test-token` | Bearer auth token |

## Output

Each runner prints:

```
Running 5 scenarios against http://localhost:3111

[PASS] sandbox-lifecycle
[PASS] filesystem-roundtrip
[PASS] exec-variations
[PASS] env-management
[PASS] snapshot-clone

5 passed, 0 failed out of 5 scenarios
```

Exit code 0 means all passed, 1 means at least one failed.
