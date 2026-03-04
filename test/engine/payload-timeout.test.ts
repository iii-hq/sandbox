import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  };
});

const mockExecInContainer = vi.fn();
const mockExecStreamInContainer = vi.fn();
const mockGetDocker = vi.fn();
const mockCreateContainer = vi.fn();
const mockCopyToContainer = vi.fn();
const mockCopyFromContainer = vi.fn();
const mockListContainerDir = vi.fn();
const mockSearchInContainer = vi.fn();
const mockGetFileInfo = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  execStreamInContainer: (...args: any[]) => mockExecStreamInContainer(...args),
  getDocker: () => mockGetDocker(),
  createContainer: (...args: any[]) => mockCreateContainer(...args),
  copyToContainer: (...args: any[]) => mockCopyToContainer(...args),
  copyFromContainer: (...args: any[]) => mockCopyFromContainer(...args),
  listContainerDir: (...args: any[]) => mockListContainerDir(...args),
  searchInContainer: (...args: any[]) => mockSearchInContainer(...args),
  getFileInfo: (...args: any[]) => mockGetFileInfo(...args),
}));

import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js";
import { registerFilesystemFunctions } from "../../packages/engine/src/functions/filesystem.js";
import { registerEnvFunctions } from "../../packages/engine/src/functions/env.js";
import { registerGitFunctions } from "../../packages/engine/src/functions/git.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Payload & Timeout Edge Cases", () => {
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
    maxFileSize: 10485760,
    cleanupOnExit: true,
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
      duration: 10,
    });

    mockExecStreamInContainer.mockImplementation(
      async (_container: any, _cmd: any, _timeout: any, onChunk: Function) => {
        onChunk({ type: "stdout", data: "output\n", timestamp: 1000 });
        onChunk({ type: "exit", data: "0", timestamp: 1001 });
      },
    );

    mockCopyToContainer.mockResolvedValue(undefined);
    mockCopyFromContainer.mockResolvedValue(Buffer.from("file content"));
    mockListContainerDir.mockResolvedValue([]);
    mockSearchInContainer.mockResolvedValue([]);
    mockGetFileInfo.mockResolvedValue([]);

    registerCommandFunctions(sdk, kv as any, config);
    registerFilesystemFunctions(sdk, kv as any, config);
    registerEnvFunctions(sdk, kv as any, config);
    registerGitFunctions(sdk, kv as any, config);
  });

  const makeStreamReq = (overrides: any = {}) => {
    const streamWritable = { write: vi.fn() };
    const response = {
      stream: streamWritable,
      sendMessage: vi.fn(),
      close: vi.fn(),
      status: vi.fn(),
      headers: vi.fn(),
    };
    return {
      req: {
        path_params: { id: "sbx_test" },
        body: { command: "echo hello" },
        headers: {},
        query_params: {},
        method: "POST",
        response,
        ...overrides,
      },
      response,
      streamWritable,
    };
  };

  describe("Large stdout output", () => {
    it("handles 10MB stdout without crashing", async () => {
      const tenMB = "x".repeat(10 * 1024 * 1024);
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: tenMB,
        stderr: "",
        duration: 500,
      });

      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: "cat bigfile" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBe(10 * 1024 * 1024);
    });

    it("handles 100MB stdout (returned as-is from exec)", async () => {
      const hundredMB = "y".repeat(100 * 1024 * 1024);
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: hundredMB,
        stderr: "",
        duration: 2000,
      });

      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: "cat hugefile" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBe(100 * 1024 * 1024);
    });
  });

  describe("Large stderr output", () => {
    it("captures 5MB stderr correctly", async () => {
      const fiveMB = "E".repeat(5 * 1024 * 1024);
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: fiveMB,
        duration: 300,
      });

      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: "bad_command" });

      expect(result.exitCode).toBe(1);
      expect(result.stderr.length).toBe(5 * 1024 * 1024);
    });
  });

  describe("Large file write/read", () => {
    it("writes 1MB content via fs::write", async () => {
      const oneMB = "A".repeat(1024 * 1024);
      const write = handlers.get("fs::write")!;
      const result = await write({
        id: "sbx_test",
        path: "/workspace/large.bin",
        content: oneMB,
      });

      expect(result.success).toBe(true);
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/large.bin",
        Buffer.from(oneMB, "utf-8"),
      );
      expect(mockCopyToContainer.mock.calls[0][2].length).toBe(1024 * 1024);
    });

    it("reads 10MB content via fs::read", async () => {
      const tenMB = "B".repeat(10 * 1024 * 1024);
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: tenMB,
        stderr: "",
        duration: 200,
      });

      const read = handlers.get("fs::read")!;
      const result = await read({
        id: "sbx_test",
        path: "/workspace/large.txt",
      });

      expect(result.length).toBe(10 * 1024 * 1024);
    });
  });

  describe("Binary content edge cases", () => {
    it("handles content with all null bytes", async () => {
      const nullContent = "\x00".repeat(1024);
      const write = handlers.get("fs::write")!;
      const result = await write({
        id: "sbx_test",
        path: "/workspace/nulls.bin",
        content: nullContent,
      });

      expect(result.success).toBe(true);
      const buf = mockCopyToContainer.mock.calls[0][2];
      expect(buf.every((b: number) => b === 0)).toBe(true);
    });

    it("handles content with all 0xFF bytes", async () => {
      const ffContent = "\xFF".repeat(1024);
      const write = handlers.get("fs::write")!;
      const result = await write({
        id: "sbx_test",
        path: "/workspace/ffs.bin",
        content: ffContent,
      });

      expect(result.success).toBe(true);
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/ffs.bin",
        expect.any(Buffer),
      );
    });

    it("handles mixed binary and text content", async () => {
      const mixed = "hello\x00world\xFF\x01binary\ntext\r\n";
      const write = handlers.get("fs::write")!;
      const result = await write({
        id: "sbx_test",
        path: "/workspace/mixed.bin",
        content: mixed,
      });

      expect(result.success).toBe(true);
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/mixed.bin",
        Buffer.from(mixed, "utf-8"),
      );
    });
  });

  describe("Very long command string", () => {
    it("passes 1MB command string to exec", async () => {
      const longCmd = "echo " + "a".repeat(1024 * 1024);
      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: longCmd });

      expect(result.exitCode).toBe(0);
      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", longCmd],
        300000,
      );
    });

    it("passes empty-ish command to validateCommand (throws)", async () => {
      const run = handlers.get("cmd::run")!;
      await expect(run({ id: "sbx_test", command: "" })).rejects.toThrow(
        "command is required",
      );
    });
  });

  describe("Very long environment variable", () => {
    it("sets env var with 1MB value", async () => {
      const bigValue = "V".repeat(1024 * 1024);
      const fn = handlers.get("env::set")!;
      const result = await fn({ id: "sbx_test", vars: { BIG_VAR: bigValue } });

      expect(result).toEqual({ set: ["BIG_VAR"], count: 1 });
      expect(mockExecInContainer).toHaveBeenCalled();
    });

    it("sets env var with 1000-char key", async () => {
      const longKey = "K".repeat(1000);
      const fn = handlers.get("env::set")!;
      const result = await fn({ id: "sbx_test", vars: { [longKey]: "value" } });

      expect(result.set).toEqual([longKey]);
      expect(result.count).toBe(1);
    });
  });

  describe("Many concurrent large operations", () => {
    it("completes 10 concurrent 1MB file writes", async () => {
      const oneMB = "D".repeat(1024 * 1024);
      const write = handlers.get("fs::write")!;
      const promises = Array.from({ length: 10 }, (_, i) =>
        write({
          id: "sbx_test",
          path: `/workspace/file_${i}.bin`,
          content: oneMB,
        }),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((r) => expect(r.success).toBe(true));
      expect(mockCopyToContainer).toHaveBeenCalledTimes(10);
    });
  });

  describe("Timeout edge cases", () => {
    it("timeout = 0 gets clamped by Math.min to 0ms", async () => {
      const run = handlers.get("cmd::run")!;
      await run({ id: "sbx_test", command: "echo test", timeout: 0 });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        0,
      );
    });

    it("timeout = -1 gets clamped to negative (Math.min handles it)", async () => {
      const run = handlers.get("cmd::run")!;
      await run({ id: "sbx_test", command: "echo test", timeout: -1 });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        -1000,
      );
    });

    it("timeout = NaN propagates as NaN (nullish coalescing does not catch NaN)", async () => {
      const run = handlers.get("cmd::run")!;
      await run({ id: "sbx_test", command: "echo test", timeout: NaN });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        NaN,
      );
    });

    it("timeout = Infinity gets clamped to maxCommandTimeout", async () => {
      const run = handlers.get("cmd::run")!;
      await run({ id: "sbx_test", command: "echo test", timeout: Infinity });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
      );
    });

    it("very large timeout gets capped at maxCommandTimeout", async () => {
      const run = handlers.get("cmd::run")!;
      await run({ id: "sbx_test", command: "echo test", timeout: 999999 });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
      );
    });

    it("undefined timeout defaults to maxCommandTimeout", async () => {
      const run = handlers.get("cmd::run")!;
      await run({ id: "sbx_test", command: "echo test" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
      );
    });
  });

  describe("Exec returns after timeout", () => {
    it("propagates timeout error from exec", async () => {
      mockExecInContainer.mockRejectedValue(
        new Error("Command timed out after 300000ms"),
      );

      const run = handlers.get("cmd::run")!;
      await expect(
        run({ id: "sbx_test", command: "sleep 9999" }),
      ).rejects.toThrow("timed out");
    });

    it("stream handler closes on exec timeout", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({
            type: "stdout",
            data: "partial output\n",
            timestamp: 1000,
          });
          onChunk({ type: "exit", data: "-1", timestamp: 1001 });
          throw new Error("Command timed out after 300000ms");
        },
      );

      const { req, response, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"exit"'),
      );
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("Very large number of environment variables", () => {
    it("sets 1000 env vars at once", async () => {
      const vars: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        vars[`VAR_${i}`] = `value_${i}`;
      }

      const fn = handlers.get("env::set")!;
      const result = await fn({ id: "sbx_test", vars });

      expect(result.count).toBe(1000);
      expect(result.set).toHaveLength(1000);
    });

    it("parses env list output with 1000 variables", async () => {
      const lines =
        Array.from({ length: 1000 }, (_, i) => `VAR_${i}=value_${i}`).join(
          "\n",
        ) + "\n";
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: lines,
        stderr: "",
        duration: 50,
      });

      const fn = handlers.get("env::list")!;
      const result = await fn({ id: "sbx_test" });

      expect(result.count).toBe(1000);
      expect(result.vars.VAR_0).toBe("value_0");
      expect(result.vars.VAR_999).toBe("value_999");
    });
  });

  describe("Empty response edge cases", () => {
    it("preserves empty strings in exec result", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 0,
      });

      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: "true" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
    });

    it("fs::read returns empty string for empty file", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 5,
      });

      const read = handlers.get("fs::read")!;
      const result = await read({
        id: "sbx_test",
        path: "/workspace/empty.txt",
      });

      expect(result).toBe("");
      expect(typeof result).toBe("string");
    });
  });

  describe("Duration edge cases", () => {
    it("handles duration = 0 (instant command)", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "fast",
        stderr: "",
        duration: 0,
      });

      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: "echo fast" });

      expect(result.exitCode).toBe(0);
      expect(result.duration).toBe(0);
    });

    it("handles very large duration value", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "done",
        stderr: "",
        duration: Number.MAX_SAFE_INTEGER,
      });

      const run = handlers.get("cmd::run")!;
      const result = await run({ id: "sbx_test", command: "long_task" });

      expect(result.exitCode).toBe(0);
      expect(result.duration).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("Git clone with very long URL", () => {
    it("handles a 10KB URL", async () => {
      const longUrl =
        "https://github.com/" + "a".repeat(10 * 1024) + "/repo.git";
      const handler = handlers.get("git::clone")!;
      await handler({ id: "sbx_test", url: longUrl });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", `git clone "${longUrl}"`],
        30000,
      );
    });
  });

  describe("Stream with huge chunks", () => {
    it("handles a single 5MB data chunk", async () => {
      const fiveMB = "S".repeat(5 * 1024 * 1024);
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: fiveMB, timestamp: 1000 });
          onChunk({ type: "exit", data: "0", timestamp: 1001 });
        },
      );

      const { req, response, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(streamWritable.write).toHaveBeenCalledTimes(2);
      const firstWrite = streamWritable.write.mock.calls[0][0];
      expect(firstWrite).toContain(fiveMB);
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("Deeply nested file paths", () => {
    it("handles path with 50 directory levels", async () => {
      const deepPath =
        "/workspace/" +
        Array.from({ length: 50 }, (_, i) => `dir${i}`).join("/") +
        "/file.txt";
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "deep content",
        stderr: "",
        duration: 10,
      });

      const read = handlers.get("fs::read")!;
      const result = await read({ id: "sbx_test", path: deepPath });

      expect(result).toBe("deep content");
      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["cat", expect.stringContaining("dir49/file.txt")],
        10000,
      );
    });

    it("creates deeply nested directories", async () => {
      const deepDir =
        "/workspace/" +
        Array.from({ length: 50 }, (_, i) => `level${i}`).join("/");
      const mkdir = handlers.get("fs::mkdir")!;
      const result = await mkdir({ id: "sbx_test", paths: [deepDir] });

      expect(result.success).toBe(true);
      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["mkdir", "-p", expect.stringContaining("level49")],
        10000,
      );
    });
  });

  describe("Stream timeout on cmd::run-stream", () => {
    it("caps stream timeout at maxCommandTimeout", async () => {
      const { req } = makeStreamReq({
        body: { command: "echo test", timeout: 99999 },
      });
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(mockExecStreamInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
        expect.any(Function),
      );
    });

    it("stream uses default maxCommandTimeout when no timeout provided", async () => {
      const { req } = makeStreamReq({ body: { command: "echo test" } });
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(mockExecStreamInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
        expect.any(Function),
      );
    });
  });

  describe("Concurrent exec and stream operations", () => {
    it("handles 5 concurrent cmd::run calls with large output", async () => {
      const oneMB = "R".repeat(1024 * 1024);
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: oneMB,
        stderr: "",
        duration: 100,
      });

      const run = handlers.get("cmd::run")!;
      const promises = Array.from({ length: 5 }, () =>
        run({ id: "sbx_test", command: "generate_output" }),
      );
      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((r) => {
        expect(r.exitCode).toBe(0);
        expect(r.stdout.length).toBe(1024 * 1024);
      });
    });
  });

  describe("Env values with special characters", () => {
    it("handles env value with newlines and equals signs", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "KEY1=value=with=equals\nKEY2=multi\nKEY3=normal\n",
        stderr: "",
        duration: 10,
      });

      const fn = handlers.get("env::list")!;
      const result = await fn({ id: "sbx_test" });

      expect(result.vars.KEY1).toBe("value=with=equals");
      expect(result.vars.KEY3).toBe("normal");
    });

    it("handles env output with empty value", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "EMPTY=\nNOTEMPTY=hello\n",
        stderr: "",
        duration: 10,
      });

      const fn = handlers.get("env::list")!;
      const result = await fn({ id: "sbx_test" });

      expect(result.vars.EMPTY).toBe("");
      expect(result.vars.NOTEMPTY).toBe("hello");
    });
  });
});
