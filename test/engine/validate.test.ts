import { describe, it, expect } from "vitest";
import {
  validatePath,
  validateSandboxConfig,
  validateImageAllowed,
  checkAuth,
  validateCommand,
} from "../../packages/engine/src/security/validate.js";
import type { ApiRequest } from "../../packages/engine/src/types.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

function makeReq(headers: Record<string, string | string[]> = {}): ApiRequest {
  return {
    path_params: {},
    query_params: {},
    body: {},
    headers,
    method: "GET",
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    engineUrl: "ws://localhost:49134",
    workerName: "iii-sandbox",
    restPort: 3111,
    apiPrefix: "/sandbox",
    authToken: null,
    defaultImage: "python:3.12-slim",
    defaultTimeout: 3600,
    defaultMemory: 512,
    defaultCpu: 1,
    maxSandboxes: 50,
    ttlSweepInterval: "*/30 * * * * *",
    metricsInterval: "*/60 * * * * *",
    allowedImages: ["*"],
    workspaceDir: "/workspace",
    maxCommandTimeout: 300,
    ...overrides,
  };
}

describe("validatePath", () => {
  it("allows paths under workspace", () => {
    const result = validatePath("/workspace/file.txt", "/workspace");
    expect(result).toBe("/workspace/file.txt");
  });

  it("rejects path traversal", () => {
    expect(() => validatePath("../../etc/passwd", "/workspace")).toThrow(
      "Path traversal",
    );
  });

  it("normalizes paths", () => {
    const result = validatePath("/workspace/./sub/../file.txt", "/workspace");
    expect(result).toBe("/workspace/file.txt");
  });

  it("allows absolute path under workspace", () => {
    const result = validatePath("/workspace/src/main.py", "/workspace");
    expect(result).toBe("/workspace/src/main.py");
  });

  it("allows deeply nested valid path", () => {
    const result = validatePath("/workspace/a/b/c/d/e/f.txt", "/workspace");
    expect(result).toBe("/workspace/a/b/c/d/e/f.txt");
  });

  it("resolves empty string to workspace root", () => {
    const result = validatePath("", "/workspace");
    expect(result).toBe("/workspace");
  });

  it("allows path with spaces", () => {
    const result = validatePath("/workspace/my folder/file.txt", "/workspace");
    expect(result).toBe("/workspace/my folder/file.txt");
  });

  it("allows unicode path", () => {
    const result = validatePath("/workspace/datos/archivo.txt", "/workspace");
    expect(result).toBe("/workspace/datos/archivo.txt");
  });

  it("rejects traversal via absolute path outside workspace", () => {
    expect(() => validatePath("/etc/passwd", "/workspace")).toThrow(
      "Path traversal",
    );
  });

  it("rejects sneaky double-dot in middle", () => {
    expect(() =>
      validatePath("/workspace/sub/../../etc/shadow", "/workspace"),
    ).toThrow("Path traversal");
  });
});

describe("validateSandboxConfig", () => {
  it("validates minimal config", () => {
    const config = validateSandboxConfig({ image: "python:3.12-slim" });
    expect(config.image).toBe("python:3.12-slim");
  });

  it("rejects missing image", () => {
    expect(() => validateSandboxConfig({})).toThrow("image is required");
  });

  it("rejects null input", () => {
    expect(() => validateSandboxConfig(null)).toThrow("Invalid sandbox config");
  });

  it("clamps memory limits", () => {
    const config = validateSandboxConfig({ image: "test", memory: 99999 });
    expect(config.memory).toBe(4096);
  });

  it("rejects suspicious image names", () => {
    expect(() => validateSandboxConfig({ image: "../evil" })).toThrow(
      "Invalid image name",
    );
  });

  it("validates full config with all fields", () => {
    const config = validateSandboxConfig({
      image: "node:20",
      name: "my-sandbox",
      timeout: 600,
      memory: 1024,
      cpu: 2,
      network: true,
      env: { NODE_ENV: "production" },
      workdir: "/app",
    });
    expect(config.image).toBe("node:20");
    expect(config.name).toBe("my-sandbox");
    expect(config.timeout).toBe(600);
    expect(config.memory).toBe(1024);
    expect(config.cpu).toBe(2);
    expect(config.network).toBe(true);
    expect(config.env).toEqual({ NODE_ENV: "production" });
    expect(config.workdir).toBe("/app");
  });

  it("clamps timeout too low to 60", () => {
    const config = validateSandboxConfig({ image: "test", timeout: 10 });
    expect(config.timeout).toBe(60);
  });

  it("clamps timeout too high to 86400", () => {
    const config = validateSandboxConfig({ image: "test", timeout: 200000 });
    expect(config.timeout).toBe(86400);
  });

  it("clamps cpu too low to 0.5", () => {
    const config = validateSandboxConfig({ image: "test", cpu: 0.1 });
    expect(config.cpu).toBe(0.5);
  });

  it("clamps cpu too high to 4", () => {
    const config = validateSandboxConfig({ image: "test", cpu: 16 });
    expect(config.cpu).toBe(4);
  });

  it("clamps memory too low to 64", () => {
    const config = validateSandboxConfig({ image: "test", memory: 8 });
    expect(config.memory).toBe(64);
  });

  it("accepts env as object", () => {
    const config = validateSandboxConfig({
      image: "test",
      env: { A: "1", B: "2" },
    });
    expect(config.env).toEqual({ A: "1", B: "2" });
  });

  it("ignores invalid env type", () => {
    const config = validateSandboxConfig({ image: "test", env: "invalid" });
    expect(config.env).toBeUndefined();
  });

  it("rejects image with dollar sign", () => {
    expect(() => validateSandboxConfig({ image: "test$injection" })).toThrow(
      "Invalid image name",
    );
  });

  it("preserves boolean network field", () => {
    const on = validateSandboxConfig({ image: "test", network: true });
    expect(on.network).toBe(true);
    const off = validateSandboxConfig({ image: "test", network: false });
    expect(off.network).toBe(false);
  });

  it("ignores non-boolean network", () => {
    const config = validateSandboxConfig({ image: "test", network: "yes" });
    expect(config.network).toBeUndefined();
  });

  it("rejects undefined input", () => {
    expect(() => validateSandboxConfig(undefined)).toThrow(
      "Invalid sandbox config",
    );
  });

  it("ignores non-string name", () => {
    const config = validateSandboxConfig({ image: "test", name: 123 });
    expect(config.name).toBeUndefined();
  });

  it("ignores non-number timeout", () => {
    const config = validateSandboxConfig({ image: "test", timeout: "fast" });
    expect(config.timeout).toBeUndefined();
  });

  it("ignores non-string workdir", () => {
    const config = validateSandboxConfig({ image: "test", workdir: 42 });
    expect(config.workdir).toBeUndefined();
  });

  it("rejects non-string image", () => {
    expect(() => validateSandboxConfig({ image: 123 })).toThrow(
      "image is required",
    );
  });
});

describe("validateImageAllowed", () => {
  it("wildcard allows all images", () => {
    expect(validateImageAllowed("anything:latest", ["*"])).toBe(true);
  });

  it("exact match works", () => {
    expect(
      validateImageAllowed("python:3.12", ["python:3.12", "node:20"]),
    ).toBe(true);
  });

  it("prefix wildcard matches", () => {
    expect(validateImageAllowed("python:3.11-slim", ["python:*"])).toBe(true);
  });

  it("prefix wildcard rejects non-matching", () => {
    expect(validateImageAllowed("node:20", ["python:*"])).toBe(false);
  });

  it("no match returns false", () => {
    expect(
      validateImageAllowed("evil:latest", ["python:3.12", "node:20"]),
    ).toBe(false);
  });

  it("empty allowed list returns false", () => {
    expect(validateImageAllowed("python:3.12", [])).toBe(false);
  });

  it("wildcard in multi-element list still matches via prefix logic", () => {
    expect(validateImageAllowed("random:image", ["python:*", "*"])).toBe(true);
  });

  it("sole wildcard allows any image", () => {
    expect(validateImageAllowed("anything:v1", ["*"])).toBe(true);
  });

  it("exact match is case-sensitive", () => {
    expect(validateImageAllowed("Python:3.12", ["python:3.12"])).toBe(false);
  });
});

describe("checkAuth", () => {
  it("returns null when no token configured", () => {
    const result = checkAuth(makeReq(), makeConfig({ authToken: null }));
    expect(result).toBeNull();
  });

  it("returns null for valid token", () => {
    const result = checkAuth(
      makeReq({ authorization: "Bearer secret123" }),
      makeConfig({ authToken: "secret123" }),
    );
    expect(result).toBeNull();
  });

  it("returns 403 for invalid token", () => {
    const result = checkAuth(
      makeReq({ authorization: "Bearer wrong" }),
      makeConfig({ authToken: "secret123" }),
    );
    expect(result).not.toBeNull();
    expect(result!.status_code).toBe(403);
  });

  it("returns 401 for missing auth header", () => {
    const result = checkAuth(
      makeReq({}),
      makeConfig({ authToken: "secret123" }),
    );
    expect(result).not.toBeNull();
    expect(result!.status_code).toBe(401);
  });

  it("handles array authorization header", () => {
    const result = checkAuth(
      makeReq({ authorization: ["Bearer secret123", "Bearer other"] }),
      makeConfig({ authToken: "secret123" }),
    );
    expect(result).toBeNull();
  });

  it("strips Bearer prefix before comparing", () => {
    const result = checkAuth(
      makeReq({ authorization: "Bearer mytoken" }),
      makeConfig({ authToken: "mytoken" }),
    );
    expect(result).toBeNull();
  });

  it("accepts raw token without Bearer prefix", () => {
    const result = checkAuth(
      makeReq({ authorization: "rawtoken" }),
      makeConfig({ authToken: "rawtoken" }),
    );
    expect(result).toBeNull();
  });
});

describe("validateCommand", () => {
  it("wraps command in sh -c", () => {
    const result = validateCommand("echo hello");
    expect(result).toEqual(["sh", "-c", "echo hello"]);
  });

  it("rejects empty command", () => {
    expect(() => validateCommand("")).toThrow("command is required");
  });

  it("preserves command with pipes", () => {
    const result = validateCommand("ls -la | grep test");
    expect(result).toEqual(["sh", "-c", "ls -la | grep test"]);
  });

  it("preserves command with semicolons", () => {
    const result = validateCommand("cd /tmp; ls");
    expect(result).toEqual(["sh", "-c", "cd /tmp; ls"]);
  });

  it("preserves command with ampersands", () => {
    const result = validateCommand("sleep 1 && echo done");
    expect(result).toEqual(["sh", "-c", "sleep 1 && echo done"]);
  });
});
