# Interactive Features Plan: WebSocket Terminal + HTTP Proxy

## 1. WebSocket Terminal (Interactive Shell)

### Problem

Current exec is request-response only. No interactive terminal (PTY).
Competitors: E2B has WebSocket terminal, CodeSandbox has full browser IDE.

### Architecture

New function: `terminal::create` returns a WebSocket URL.
Client connects and gets a bidirectional PTY stream.

```
Client <--WebSocket--> Worker <--exec(tty=true)--> Container
```

### Implementation

New file: `packages/worker/src/functions/terminal.rs`

```rust
pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV) {
    // terminal::create — create exec with TTY, return session ID
    // terminal::resize — send SIGWINCH (cols, rows)
    // terminal::close — detach exec
}
```

Docker exec with TTY:
```rust
let exec = docker.create_exec(&container_name, CreateExecOptions {
    cmd: Some(vec!["/bin/bash"]),
    attach_stdin: Some(true),
    attach_stdout: Some(true),
    attach_stderr: Some(true),
    tty: Some(true),
    ..Default::default()
}).await?;
```

### Trigger Registration

```rust
iii.register_trigger("http", "terminal::create", json!({
    "api_path": "sandbox/sandboxes/{id}/terminal",
    "http_method": "POST"
}));

// WebSocket upgrade handled by iii-engine HTTP trigger
iii.register_trigger("websocket", "terminal::stream", json!({
    "api_path": "sandbox/sandboxes/{id}/terminal/{sessionId}/ws"
}));
```

### SDK Addition

```typescript
// TypeScript SDK
const terminal = await sandbox.terminal.create({ cols: 80, rows: 24 });
terminal.onData((data: string) => process.stdout.write(data));
terminal.write("ls -la\n");
terminal.resize(120, 40);
terminal.close();
```

```python
# Python SDK
terminal = await sandbox.terminal.create(cols=80, rows=24)
async for data in terminal:
    print(data, end="")
await terminal.write("ls -la\n")
await terminal.close()
```

---

## 2. HTTP Proxy (Port Forwarding)

### Problem

Sandboxes can expose ports but there's no HTTP proxy to access them externally.
Competitors: Fly/Modal/Daytona provide public URLs for exposed ports.

### Architecture

```
External Request --> Worker HTTP Proxy --> Container:port
https://sbx-{id}-{port}.sandbox.example.com --> container internal port
```

### Implementation

New file: `packages/worker/src/functions/proxy.rs`

```rust
pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV) {
    // proxy::request — forward HTTP request to container port
    // proxy::config — set proxy auth, rate limits, CORS
}
```

### Trigger

```rust
iii.register_trigger("http", "proxy::request", json!({
    "api_path": "sandbox/proxy/{id}/{port}/*",
    "http_method": "*"
}));
```

The handler:
1. Validates sandbox exists and port is exposed
2. Forwards the full HTTP request (method, headers, body) to `container_ip:port`
3. Streams response back

### SDK Addition

```typescript
const url = sandbox.ports.getProxyUrl(3000);
// Returns: https://sbx-abc123-3000.sandbox.example.com
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/worker/src/functions/terminal.rs` | CREATE |
| `packages/worker/src/functions/proxy.rs` | CREATE |
| `packages/worker/src/functions/mod.rs` | MODIFY — add terminal, proxy |
| `packages/worker/src/triggers/api.rs` | MODIFY — add routes |
| `packages/sdk/src/managers/terminal.ts` | CREATE |
| `packages/sdk/src/managers/proxy.ts` | CREATE |
| `packages/sdk-python/iii_sandbox/managers/terminal.py` | CREATE |
| `packages/sdk-rust/src/managers/terminal.rs` | CREATE |
