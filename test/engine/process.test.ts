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

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => mockGetDocker(),
}));

import { registerProcessFunctions } from "../../packages/engine/src/functions/process.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Process Functions", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, any>;

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

  const mockContainer = {
    id: "container-1",
    top: vi.fn(),
  };

  beforeEach(() => {
    handlers = new Map();
    kvStore = new Map();
    kvStore.set("sbx_test", runningSandbox);

    const kv = {
      get: vi.fn(
        async (_scope: string, key: string) => kvStore.get(key) ?? null,
      ),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
    };

    mockGetDocker.mockReturnValue({
      getContainer: () => mockContainer,
    });

    mockContainer.top.mockResolvedValue({
      Titles: ["PID", "USER", "%CPU", "%MEM", "COMMAND"],
      Processes: [
        ["1", "root", "0.1", "0.5", "/bin/sh"],
        ["42", "node", "2.3", "1.2", "node app.js"],
      ],
    });

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 50,
    });

    registerProcessFunctions(sdk, kv as any, config);
  });

  describe("proc::list", () => {
    it("lists processes using container.top()", async () => {
      const list = handlers.get("proc::list")!;
      const result = await list({ id: "sbx_test" });

      expect(result.processes).toHaveLength(2);
      expect(result.processes[0]).toEqual({
        pid: 1,
        user: "root",
        cpu: "0.1",
        memory: "0.5",
        command: "/bin/sh",
      });
      expect(result.processes[1]).toEqual({
        pid: 42,
        user: "node",
        cpu: "2.3",
        memory: "1.2",
        command: "node app.js",
      });
    });

    it("throws for non-existent sandbox", async () => {
      const list = handlers.get("proc::list")!;
      await expect(list({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });

    it("throws for non-running sandbox", async () => {
      kvStore.set("sbx_paused", {
        ...runningSandbox,
        id: "sbx_paused",
        status: "paused",
      });
      const list = handlers.get("proc::list")!;
      await expect(list({ id: "sbx_paused" })).rejects.toThrow("not running");
    });

    it("handles empty process list", async () => {
      mockContainer.top.mockResolvedValue({
        Titles: ["PID", "USER", "%CPU", "%MEM", "COMMAND"],
        Processes: [],
      });
      const list = handlers.get("proc::list")!;
      const result = await list({ id: "sbx_test" });
      expect(result.processes).toEqual([]);
    });
  });

  describe("proc::kill", () => {
    it("kills a process with default TERM signal", async () => {
      const kill = handlers.get("proc::kill")!;
      const result = await kill({ id: "sbx_test", pid: 42 });

      expect(result).toEqual({ killed: 42, signal: "TERM" });
      expect(mockExecInContainer).toHaveBeenCalledWith(
        mockContainer,
        ["kill", "-TERM", "42"],
        10000,
      );
    });

    it("kills a process with specified signal", async () => {
      const kill = handlers.get("proc::kill")!;
      const result = await kill({ id: "sbx_test", pid: 42, signal: "KILL" });

      expect(result).toEqual({ killed: 42, signal: "KILL" });
      expect(mockExecInContainer).toHaveBeenCalledWith(
        mockContainer,
        ["kill", "-KILL", "42"],
        10000,
      );
    });

    it("rejects invalid signal", async () => {
      const kill = handlers.get("proc::kill")!;
      await expect(
        kill({ id: "sbx_test", pid: 42, signal: "INVALID" }),
      ).rejects.toThrow("Invalid signal");
    });

    it("throws for non-existent sandbox", async () => {
      const kill = handlers.get("proc::kill")!;
      await expect(
        kill({ id: "sbx_missing", pid: 42 }),
      ).rejects.toThrow("Sandbox not found");
    });
  });

  describe("proc::top", () => {
    it("parses ps aux output", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout:
          "root         1  0.0  0.1  2384  1280 ?        Ss   00:00   0:00 /bin/sh\nnode        42  2.3  1.2 98765 12345 ?        Sl   00:00   0:05 node app.js",
        stderr: "",
        duration: 50,
      });

      const top = handlers.get("proc::top")!;
      const result = await top({ id: "sbx_test" });

      expect(result.processes).toHaveLength(2);
      expect(result.processes[0].pid).toBe(1);
      expect(result.processes[0].cpu).toBe("0.0");
      expect(result.processes[0].mem).toBe("0.1");
      expect(result.processes[0].vsz).toBe(2384);
      expect(result.processes[0].rss).toBe(1280);
      expect(result.processes[0].command).toBe("/bin/sh");
    });

    it("calls correct ps command", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
      });

      const top = handlers.get("proc::top")!;
      await top({ id: "sbx_test" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        mockContainer,
        ["sh", "-c", "ps aux --no-headers"],
        10000,
      );
    });

    it("handles empty output", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
      });

      const top = handlers.get("proc::top")!;
      const result = await top({ id: "sbx_test" });
      expect(result.processes).toEqual([]);
    });

    it("throws for non-existent sandbox", async () => {
      const top = handlers.get("proc::top")!;
      await expect(top({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });
});
