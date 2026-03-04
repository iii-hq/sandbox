import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  };
});

const mockExecInContainer = vi.fn();
const mockGetDocker = vi.fn();
const mockCopyToContainer = vi.fn();
const mockCopyFromContainer = vi.fn();
const mockListContainerDir = vi.fn();
const mockSearchInContainer = vi.fn();
const mockGetFileInfo = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => mockGetDocker(),
  copyToContainer: (...args: any[]) => mockCopyToContainer(...args),
  copyFromContainer: (...args: any[]) => mockCopyFromContainer(...args),
  listContainerDir: (...args: any[]) => mockListContainerDir(...args),
  searchInContainer: (...args: any[]) => mockSearchInContainer(...args),
  getFileInfo: (...args: any[]) => mockGetFileInfo(...args),
}));

import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js";
import { registerEnvFunctions } from "../../packages/engine/src/functions/env.js";
import { registerGitFunctions } from "../../packages/engine/src/functions/git.js";
import { registerFilesystemFunctions } from "../../packages/engine/src/functions/filesystem.js";
import {
  validatePath,
  validateSandboxConfig,
  checkAuth,
  validateCommand,
  validateChmodMode,
  validateSearchPattern,
} from "../../packages/engine/src/security/validate.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";
import type { ApiRequest } from "../../packages/engine/src/types.js";

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

describe("Security Edge Cases", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, any>;
  let kv: any;

  const config: EngineConfig = {
    apiPrefix: "/sandbox",
    maxSandboxes: 10,
    defaultTimeout: 3600,
    defaultMemory: 512,
    defaultCpu: 1,
    maxCommandTimeout: 300,
    workspaceDir: "/workspace",
    allowedImages: ["*"],
    authToken: "",
    engineUrl: "ws://localhost:49134",
    workerName: "test",
    restPort: 3111,
    defaultImage: "python:3.12-slim",
    ttlSweepInterval: "*/30 * * * * *",
    metricsInterval: "*/60 * * * * *",
  };

  const runningSandbox = {
    id: "sbx_test",
    name: "test",
    image: "python:3.12-slim",
    status: "running",
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: {},
    metadata: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();

    handlers = new Map();
    kvStore = new Map();
    kvStore.set("sbx_test", { ...runningSandbox });

    kv = {
      get: vi.fn(
        async (_scope: string, key: string) => kvStore.get(key) ?? null,
      ),
      set: vi.fn(async (_scope: string, key: string, value: any) => {
        kvStore.set(key, value);
      }),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
    };

    mockGetDocker.mockReturnValue({
      getContainer: () => ({ id: "container-1" }),
    });

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 50,
    });

    mockCopyToContainer.mockResolvedValue(undefined);
    mockCopyFromContainer.mockResolvedValue(Buffer.from("content"));
    mockListContainerDir.mockResolvedValue([]);
    mockSearchInContainer.mockResolvedValue([]);
    mockGetFileInfo.mockResolvedValue([]);

    registerCommandFunctions(sdk, kv as any, config);
    registerEnvFunctions(sdk, kv as any, config);
    registerGitFunctions(sdk, kv as any, config);
    registerFilesystemFunctions(sdk, kv as any, config);
  });

  describe("Command injection via git branch names", () => {
    it("wraps branch name with semicolons in quotes", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 10,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "* main\n",
          stderr: "",
          duration: 10,
        });

      const handler = handlers.get("git::branch")!;
      await handler({ id: "sbx_test", name: '"; rm -rf /; echo "' });

      const firstCall = mockExecInContainer.mock.calls[0];
      const cmd = firstCall[1][2];
      expect(cmd).toContain('git checkout -b "');
    });

    it("wraps branch name with $() substitution in quotes", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 10,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "* main\n",
          stderr: "",
          duration: 10,
        });

      const handler = handlers.get("git::branch")!;
      await handler({ id: "sbx_test", name: "$(whoami)" });

      const firstCall = mockExecInContainer.mock.calls[0];
      const cmd = firstCall[1][2];
      expect(cmd).toBe('cd "/workspace" && git checkout -b "$(whoami)"');
    });

    it("wraps branch name with backtick substitution in quotes", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 10,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "* main\n",
          stderr: "",
          duration: 10,
        });

      const handler = handlers.get("git::branch")!;
      await handler({ id: "sbx_test", name: "`id`" });

      const firstCall = mockExecInContainer.mock.calls[0];
      const cmd = firstCall[1][2];
      expect(cmd).toBe('cd "/workspace" && git checkout -b "`id`"');
    });

    it("wraps branch name with pipe in quotes for delete", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 10,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "* main\n",
          stderr: "",
          duration: 10,
        });

      const handler = handlers.get("git::branch")!;
      await handler({ id: "sbx_test", name: "main | rm -rf /", delete: true });

      const firstCall = mockExecInContainer.mock.calls[0];
      const cmd = firstCall[1][2];
      expect(cmd).toBe('cd "/workspace" && git branch -d "main | rm -rf /"');
    });
  });

  describe("Environment variable injection", () => {
    it("passes key with newline injection to printenv in quotes", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "",
        duration: 10,
      });

      const handler = handlers.get("env::get")!;
      await handler({ id: "sbx_test", key: "KEY\nMALICIOUS=evil" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'printenv "KEY\nMALICIOUS=evil"'],
        10000,
      );
    });

    it("passes key with shell metacharacters to printenv in quotes", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "",
        duration: 10,
      });

      const handler = handlers.get("env::get")!;
      await handler({ id: "sbx_test", key: "KEY;rm -rf /" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'printenv "KEY;rm -rf /"'],
        10000,
      );
    });

    it("escapes single quotes in env::set values", async () => {
      const handler = handlers.get("env::set")!;
      await handler({ id: "sbx_test", vars: { KEY: "val'ue" } });

      const envSetCall = mockExecInContainer.mock.calls.find((c: any[]) =>
        c[1][2].includes("printf"),
      );
      expect(envSetCall).toBeDefined();
      const cmd = envSetCall![1][2];
      expect(cmd).toContain("'\\''");
    });

    it("passes backtick values through env::set single-quote escaping", async () => {
      const handler = handlers.get("env::set")!;
      await handler({ id: "sbx_test", vars: { KEY: "val`cmd`" } });

      const envSetCall = mockExecInContainer.mock.calls.find((c: any[]) =>
        c[1][2].includes("printf"),
      );
      expect(envSetCall).toBeDefined();
      const cmd = envSetCall![1][2];
      expect(cmd).toContain("val`cmd`");
      expect(cmd).toContain("printf '%s\\n'");
    });
  });

  describe("Path traversal edge cases", () => {
    it("allows /workspace/ trailing slash", () => {
      const result = validatePath("/workspace/", "/workspace");
      expect(result).toBe("/workspace");
    });

    it("allows /workspace exactly", () => {
      const result = validatePath("/workspace", "/workspace");
      expect(result).toBe("/workspace");
    });

    it("rejects double-slash traversal /workspace//../../etc/passwd", () => {
      expect(() =>
        validatePath("/workspace//../../etc/passwd", "/workspace"),
      ).toThrow("Path traversal");
    });

    it("rejects dot-slash traversal /workspace/./../../../../etc/shadow", () => {
      expect(() =>
        validatePath("/workspace/./../../../../etc/shadow", "/workspace"),
      ).toThrow("Path traversal");
    });

    it("handles null byte prefix in path without crashing", () => {
      expect(() =>
        validatePath("\x00/workspace/file.txt", "/workspace"),
      ).not.toThrow();
    });

    it("rejects null byte in middle of path that resolves outside workspace", () => {
      expect(() =>
        validatePath("/workspace\x00/../../etc/passwd", "/workspace"),
      ).toThrow("Path traversal");
    });

    it("allows very long path under workspace (4097 chars)", () => {
      const longPath = "/workspace/" + "a".repeat(4086);
      const result = validatePath(longPath, "/workspace");
      expect(result.startsWith("/workspace")).toBe(true);
    });

    it("treats URL-encoded traversal as literal characters", () => {
      const result = validatePath(
        "/workspace/..%2f..%2fetc/passwd",
        "/workspace",
      );
      expect(result).toBe("/workspace/..%2f..%2fetc/passwd");
    });

    it("rejects path traversal through fs::read handler", async () => {
      const handler = handlers.get("fs::read")!;
      await expect(
        handler({ id: "sbx_test", path: "/workspace/../../../etc/passwd" }),
      ).rejects.toThrow("Path traversal");
    });

    it("rejects double-slash traversal through fs::write handler", async () => {
      const handler = handlers.get("fs::write")!;
      await expect(
        handler({
          id: "sbx_test",
          path: "/workspace//../../etc/crontab",
          content: "evil",
        }),
      ).rejects.toThrow("Path traversal");
    });
  });

  describe("Auth edge cases", () => {
    it("treats double-space Bearer as wrong token", () => {
      const result = checkAuth(
        makeReq({ authorization: "Bearer  token" }),
        makeConfig({ authToken: "token" }),
      );
      expect(result).not.toBeNull();
      expect(result!.status_code).toBe(403);
    });

    it("rejects empty Bearer value", () => {
      const result = checkAuth(
        makeReq({ authorization: "Bearer " }),
        makeConfig({ authToken: "secret" }),
      );
      expect(result).not.toBeNull();
      expect(result!.status_code).toBe(403);
    });

    it("rejects 'Bearer' with no space or token", () => {
      const result = checkAuth(
        makeReq({ authorization: "Bearer" }),
        makeConfig({ authToken: "secret" }),
      );
      expect(result).not.toBeNull();
      expect(result!.status_code).toBe(403);
    });

    it("rejects very long token (100KB)", () => {
      const longToken = "a".repeat(100 * 1024);
      const result = checkAuth(
        makeReq({ authorization: `Bearer ${longToken}` }),
        makeConfig({ authToken: "secret" }),
      );
      expect(result).not.toBeNull();
      expect(result!.status_code).toBe(403);
    });

    it("rejects token with null bytes", () => {
      const result = checkAuth(
        makeReq({ authorization: "Bearer sec\x00ret" }),
        makeConfig({ authToken: "secret" }),
      );
      expect(result).not.toBeNull();
      expect(result!.status_code).toBe(403);
    });

    it("treats lowercase 'bearer' as literal prefix match (replace strips 'Bearer ')", () => {
      const result = checkAuth(
        makeReq({ authorization: "bearer token" }),
        makeConfig({ authToken: "bearer token" }),
      );
      expect(result).toBeNull();
    });

    it("treats uppercase 'BEARER' the same way", () => {
      const result = checkAuth(
        makeReq({ authorization: "BEARER token" }),
        makeConfig({ authToken: "BEARER token" }),
      );
      expect(result).toBeNull();
    });
  });

  describe("Chmod mode injection", () => {
    it("rejects mode with shell injection: '777; rm -rf /'", () => {
      expect(() => validateChmodMode("777; rm -rf /")).toThrow(
        "Invalid chmod mode",
      );
    });

    it("rejects mode with command substitution: '$(id)'", () => {
      expect(() => validateChmodMode("$(id)")).toThrow("Invalid chmod mode");
    });

    it("rejects empty string", () => {
      expect(() => validateChmodMode("")).toThrow("mode is required");
    });

    it("rejects out-of-range octal: '99999'", () => {
      expect(() => validateChmodMode("99999")).toThrow("Invalid chmod mode");
    });

    it("accepts valid octal mode 755", () => {
      expect(validateChmodMode("755")).toBe("755");
    });

    it("accepts valid octal mode 0644", () => {
      expect(validateChmodMode("0644")).toBe("0644");
    });

    it("accepts valid symbolic mode u+x", () => {
      expect(validateChmodMode("u+x")).toBe("u+x");
    });

    it("accepts valid symbolic mode go-w", () => {
      expect(validateChmodMode("go-w")).toBe("go-w");
    });

    it("rejects chmod injection through fs::chmod handler", async () => {
      const handler = handlers.get("fs::chmod")!;
      await expect(
        handler({
          id: "sbx_test",
          path: "/workspace/file.sh",
          mode: "777 && whoami",
        }),
      ).rejects.toThrow("Invalid chmod mode");
    });
  });

  describe("Search pattern injection", () => {
    it("rejects pattern with semicolons", () => {
      expect(() => validateSearchPattern("*.txt; rm -rf /")).toThrow(
        "invalid characters",
      );
    });

    it("rejects pattern with pipes", () => {
      expect(() => validateSearchPattern("*.txt | cat /etc/passwd")).toThrow(
        "invalid characters",
      );
    });

    it("rejects pattern with backticks", () => {
      expect(() => validateSearchPattern("*.txt`whoami`")).toThrow(
        "invalid characters",
      );
    });

    it("rejects pattern with $() substitution", () => {
      expect(() => validateSearchPattern("$(cat /etc/passwd)")).toThrow(
        "invalid characters",
      );
    });

    it("rejects pattern longer than 200 chars", () => {
      const long = "a".repeat(201);
      expect(() => validateSearchPattern(long)).toThrow("too long");
    });

    it("rejects empty pattern", () => {
      expect(() => validateSearchPattern("")).toThrow(
        "search pattern is required",
      );
    });

    it("allows valid glob pattern", () => {
      expect(validateSearchPattern("*.py")).toBe("*.py");
    });

    it("rejects pattern injection through fs::search handler", async () => {
      const handler = handlers.get("fs::search")!;
      await expect(
        handler({ id: "sbx_test", pattern: "*.txt; rm -rf /" }),
      ).rejects.toThrow("invalid characters");
    });
  });

  describe("Image name injection", () => {
    it("does not reject image with semicolons (no semicolon check in validator)", () => {
      const result = validateSandboxConfig({ image: "python:3.12; rm -rf /" });
      expect(result.image).toBe("python:3.12; rm -rf /");
    });

    it("rejects image with $() command substitution", () => {
      expect(() =>
        validateSandboxConfig({ image: "$(whoami):latest" }),
      ).toThrow("Invalid image name");
    });

    it("accepts valid image name", () => {
      const result = validateSandboxConfig({ image: "python:latest" });
      expect(result.image).toBe("python:latest");
    });

    it("rejects image with backticks via $ check", () => {
      expect(() =>
        validateSandboxConfig({ image: "test$`whoami`:latest" }),
      ).toThrow("Invalid image name");
    });

    it("rejects image with double-dot traversal", () => {
      expect(() =>
        validateSandboxConfig({ image: "../../../etc/passwd" }),
      ).toThrow("Invalid image name");
    });
  });

  describe("Git URL injection", () => {
    it("wraps malicious URL with semicolons in quotes", async () => {
      const handler = handlers.get("git::clone")!;
      await handler({ id: "sbx_test", url: "; rm -rf /" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone "; rm -rf /"'],
        30000,
      );
    });

    it("wraps URL with $() substitution in quotes", async () => {
      const handler = handlers.get("git::clone")!;
      await handler({ id: "sbx_test", url: "$(whoami)" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone "$(whoami)"'],
        30000,
      );
    });

    it("wraps URL with backtick substitution in quotes", async () => {
      const handler = handlers.get("git::clone")!;
      await handler({ id: "sbx_test", url: "`cat /etc/passwd`" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone "`cat /etc/passwd`"'],
        30000,
      );
    });

    it("wraps both URL and branch in quotes when both are malicious", async () => {
      const handler = handlers.get("git::clone")!;
      await handler({
        id: "sbx_test",
        url: "; rm -rf /",
        branch: "; echo pwned",
      });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone --branch "; echo pwned" "; rm -rf /"'],
        30000,
      );
    });
  });

  describe("File content injection", () => {
    it("writes content with control characters via copyToContainer", async () => {
      const handler = handlers.get("fs::write")!;
      const content = "normal\x00\x01\x02\x03\x1b[31mred\x1b[0m";
      const result = await handler({
        id: "sbx_test",
        path: "/workspace/test.bin",
        content,
      });

      expect(result.success).toBe(true);
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/test.bin",
        Buffer.from(content, "utf-8"),
      );
    });

    it("writes extremely long single-line content", async () => {
      const handler = handlers.get("fs::write")!;
      const content = "x".repeat(1024 * 1024);
      const result = await handler({
        id: "sbx_test",
        path: "/workspace/large.txt",
        content,
      });

      expect(result.success).toBe(true);
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/large.txt",
        Buffer.from(content, "utf-8"),
      );
    });
  });

  describe("Sandbox name injection", () => {
    it("accepts name with shell metacharacters in config (stored as string)", () => {
      const result = validateSandboxConfig({
        image: "python:3.12",
        name: 'test; rm -rf /"',
      });
      expect(result.name).toBe('test; rm -rf /"');
    });

    it("accepts name with path separators in config", () => {
      const result = validateSandboxConfig({
        image: "python:3.12",
        name: "../../etc/passwd",
      });
      expect(result.name).toBe("../../etc/passwd");
    });

    it("accepts name with null bytes in config (stored as string)", () => {
      const result = validateSandboxConfig({
        image: "python:3.12",
        name: "test\x00evil",
      });
      expect(result.name).toBe("test\x00evil");
    });

    it("ignores non-string name in config", () => {
      const result = validateSandboxConfig({
        image: "python:3.12",
        name: { malicious: true } as any,
      });
      expect(result.name).toBeUndefined();
    });
  });

  describe("Env delete key injection", () => {
    it("passes key with regex metacharacters to sed (potential regex injection)", async () => {
      const handler = handlers.get("env::delete")!;
      await handler({ id: "sbx_test", key: ".*" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", "sed -i '/^.*=/d' /etc/environment"],
        10000,
      );
    });

    it("passes key with slash to sed (potential sed delimiter escape)", async () => {
      const handler = handlers.get("env::delete")!;
      await handler({ id: "sbx_test", key: "KEY/d' /etc/passwd; echo '" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        [
          "sh",
          "-c",
          "sed -i '/^KEY/d' /etc/passwd; echo '=/d' /etc/environment",
        ],
        10000,
      );
    });
  });

  describe("Git commit message injection", () => {
    it("escapes single quotes to prevent shell breakout", async () => {
      const handler = handlers.get("git::commit")!;
      await handler({
        id: "sbx_test",
        message: "'; rm -rf / #",
      });

      const call = mockExecInContainer.mock.calls[0];
      const cmd = call[1][2];
      expect(cmd).toContain("'\\''");
      expect(cmd).toContain("git commit -m ''\\''");
    });

    it("handles message with backticks via single-quote wrapping", async () => {
      const handler = handlers.get("git::commit")!;
      await handler({
        id: "sbx_test",
        message: "test `whoami` commit",
      });

      const call = mockExecInContainer.mock.calls[0];
      const cmd = call[1][2];
      expect(cmd).toContain("git commit -m 'test `whoami` commit'");
    });

    it("handles message with $() via single-quote wrapping", async () => {
      const handler = handlers.get("git::commit")!;
      await handler({
        id: "sbx_test",
        message: "test $(cat /etc/passwd) commit",
      });

      const call = mockExecInContainer.mock.calls[0];
      const cmd = call[1][2];
      expect(cmd).toContain("git commit -m 'test $(cat /etc/passwd) commit'");
    });
  });

  describe("Command validation edge cases", () => {
    it("rejects null command", () => {
      expect(() => validateCommand(null as any)).toThrow("command is required");
    });

    it("rejects undefined command", () => {
      expect(() => validateCommand(undefined as any)).toThrow(
        "command is required",
      );
    });

    it("rejects numeric command", () => {
      expect(() => validateCommand(123 as any)).toThrow("command is required");
    });

    it("preserves command with all shell metacharacters (sandboxed execution)", () => {
      const result = validateCommand(
        "echo $HOME && cat /etc/passwd | grep root; whoami",
      );
      expect(result).toEqual([
        "sh",
        "-c",
        "echo $HOME && cat /etc/passwd | grep root; whoami",
      ]);
    });
  });

  describe("Git checkout ref injection", () => {
    it("wraps malicious ref with semicolons in quotes", async () => {
      const handler = handlers.get("git::checkout")!;
      await handler({ id: "sbx_test", ref: "; rm -rf /" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git checkout "; rm -rf /"'],
        30000,
      );
    });

    it("wraps ref with $() substitution in quotes", async () => {
      const handler = handlers.get("git::checkout")!;
      await handler({ id: "sbx_test", ref: "$(whoami)" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git checkout "$(whoami)"'],
        30000,
      );
    });
  });

  describe("Git push remote/branch injection", () => {
    it("wraps malicious remote in quotes", async () => {
      const handler = handlers.get("git::push")!;
      await handler({ id: "sbx_test", remote: "; rm -rf /" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git push "; rm -rf /"'],
        30000,
      );
    });

    it("wraps malicious branch in quotes", async () => {
      const handler = handlers.get("git::push")!;
      await handler({ id: "sbx_test", branch: "$(cat /etc/passwd)" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git push "$(cat /etc/passwd)"'],
        30000,
      );
    });
  });

  describe("CWD injection via cmd::run", () => {
    it("rejects cwd path traversal", async () => {
      const handler = handlers.get("cmd::run")!;
      await expect(
        handler({ id: "sbx_test", command: "ls", cwd: "/etc" }),
      ).rejects.toThrow("Path traversal");
    });

    it("quotes cwd in the command to prevent injection", async () => {
      const handler = handlers.get("cmd::run")!;
      await handler({
        id: "sbx_test",
        command: "ls",
        cwd: "/workspace/my dir",
      });

      const call = mockExecInContainer.mock.calls[0];
      const cmd = call[1][2];
      expect(cmd).toContain('cd "/workspace/my dir"');
    });
  });
});
