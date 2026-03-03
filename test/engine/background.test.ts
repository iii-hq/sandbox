import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

const mockExecInContainer = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => ({
    getContainer: () => ({
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}));

import { registerBackgroundFunctions } from "../../packages/engine/src/functions/background.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Background Functions", () => {
  let handlers: Map<string, Function>;
  let store: Record<string, Record<string, any>>;

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

  beforeEach(() => {
    handlers = new Map();
    store = {
      sandbox: {
        sbx_test: { id: "sbx_test", status: "running" },
        sbx_paused: { id: "sbx_paused", status: "paused" },
      },
      background: {},
    };

    const kv = {
      get: vi.fn(
        async (scope: string, key: string) => store[scope]?.[key] ?? null,
      ),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!store[scope]) store[scope] = {};
        store[scope][key] = value;
      }),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
    };

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "log output",
      stderr: "",
      duration: 10,
    });

    registerBackgroundFunctions(sdk, kv as any, config);
  });

  describe("cmd::background", () => {
    it("starts a background command", async () => {
      const bg = handlers.get("cmd::background")!;
      const result = await bg({ id: "sbx_test", command: "python train.py" });

      expect(result.id).toBeTruthy();
      expect(result.id).toMatch(/^bg_/);
      expect(result.sandboxId).toBe("sbx_test");
      expect(result.command).toBe("python train.py");
      expect(result.running).toBe(true);
      expect(result.startedAt).toBeGreaterThan(0);
    });

    it("throws for non-existent sandbox", async () => {
      const bg = handlers.get("cmd::background")!;
      await expect(bg({ id: "sbx_missing", command: "ls" })).rejects.toThrow(
        "Sandbox not found",
      );
    });

    it("throws for non-running sandbox", async () => {
      const bg = handlers.get("cmd::background")!;
      await expect(bg({ id: "sbx_paused", command: "ls" })).rejects.toThrow(
        "not running",
      );
    });

    it("stores background exec in KV", async () => {
      const bg = handlers.get("cmd::background")!;
      const result = await bg({ id: "sbx_test", command: "sleep 100" });

      expect(store.background[result.id]).toBeDefined();
      expect(store.background[result.id].sandboxId).toBe("sbx_test");
    });
  });

  describe("cmd::background-status", () => {
    it("returns background exec status", async () => {
      const bg = handlers.get("cmd::background")!;
      const created = await bg({ id: "sbx_test", command: "python train.py" });

      const status = handlers.get("cmd::background-status")!;
      const result = await status({ id: created.id });

      expect(result.id).toBe(created.id);
      expect(result.running).toBe(true);
    });

    it("throws for non-existent background exec", async () => {
      const status = handlers.get("cmd::background-status")!;
      await expect(status({ id: "bg_missing" })).rejects.toThrow(
        "Background exec not found",
      );
    });
  });

  describe("cmd::background-logs", () => {
    it("returns logs with cursor", async () => {
      const bg = handlers.get("cmd::background")!;
      const created = await bg({ id: "sbx_test", command: "python train.py" });

      const logs = handlers.get("cmd::background-logs")!;
      const result = await logs({ id: created.id });

      expect(result.output).toBe("log output");
      expect(result.cursor).toBeGreaterThan(0);
    });

    it("supports cursor-based pagination", async () => {
      const bg = handlers.get("cmd::background")!;
      const created = await bg({ id: "sbx_test", command: "echo test" });

      const logs = handlers.get("cmd::background-logs")!;
      const result = await logs({ id: created.id, cursor: 5 });

      expect(result.cursor).toBeGreaterThan(5);
    });

    it("throws for non-existent background exec", async () => {
      const logs = handlers.get("cmd::background-logs")!;
      await expect(logs({ id: "bg_missing" })).rejects.toThrow(
        "Background exec not found",
      );
    });
  });

  describe("cmd::interrupt", () => {
    it("interrupts with specific PID", async () => {
      const interrupt = handlers.get("cmd::interrupt")!;
      const result = await interrupt({ id: "sbx_test", pid: 1234 });
      expect(result.success).toBe(true);

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["kill", "-SIGINT", "1234"],
        5000,
      );
    });

    it("interrupts all processes when no PID", async () => {
      const interrupt = handlers.get("cmd::interrupt")!;
      const result = await interrupt({ id: "sbx_test" });
      expect(result.success).toBe(true);

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["pkill", "-SIGINT", "-f", "sh -c"],
        5000,
      );
    });

    it("throws for non-existent sandbox", async () => {
      const interrupt = handlers.get("cmd::interrupt")!;
      await expect(interrupt({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });
});
