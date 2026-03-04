import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

const mockGetContainerStats = vi.fn();
const mockGetDocker = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
  getDocker: () => mockGetDocker(),
}));

import { registerMonitorFunctions } from "../../packages/engine/src/functions/monitor.js";

describe("Monitor Functions", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;
  let sdk: any;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
    kvStore = new Map();

    const kv = {
      get: vi.fn(async (scope: string, key: string) => kvStore.get(scope)?.get(key) ?? null),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!kvStore.has(scope)) kvStore.set(scope, new Map());
        kvStore.get(scope)!.set(key, value);
      }),
      delete: vi.fn(async (scope: string, key: string) => {
        kvStore.get(scope)?.delete(key);
      }),
      list: vi.fn(async (scope: string) => {
        const m = kvStore.get(scope);
        return m ? Array.from(m.values()) : [];
      }),
    };

    sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: vi.fn(),
    };

    const config = {
      engineUrl: "ws://localhost:49134",
      workerName: "test",
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
    };

    registerMonitorFunctions(sdk, kv as any, config);
  });

  describe("monitor::set-alert", () => {
    it("creates a cpu alert", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" });

      const handler = handlers.get("monitor::set-alert")!;
      const result = await handler({ id: "sbx_1", metric: "cpu", threshold: 80 });

      expect(result.sandboxId).toBe("sbx_1");
      expect(result.metric).toBe("cpu");
      expect(result.threshold).toBe(80);
      expect(result.action).toBe("notify");
      expect(result.triggered).toBe(false);
      expect(result.id).toMatch(/^alrt_/);
    });

    it("creates a memory alert with kill action", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" });

      const handler = handlers.get("monitor::set-alert")!;
      const result = await handler({ id: "sbx_1", metric: "memory", threshold: 90, action: "kill" });

      expect(result.metric).toBe("memory");
      expect(result.action).toBe("kill");
    });

    it("creates a pids alert", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" });

      const handler = handlers.get("monitor::set-alert")!;
      const result = await handler({ id: "sbx_1", metric: "pids", threshold: 200 });

      expect(result.metric).toBe("pids");
      expect(result.threshold).toBe(200);
    });

    it("rejects invalid metric", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1" });

      const handler = handlers.get("monitor::set-alert")!;
      await expect(handler({ id: "sbx_1", metric: "disk", threshold: 50 })).rejects.toThrow("Invalid metric");
    });

    it("rejects cpu threshold out of range", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1" });

      const handler = handlers.get("monitor::set-alert")!;
      await expect(handler({ id: "sbx_1", metric: "cpu", threshold: 150 })).rejects.toThrow("threshold must be between 0 and 100");
    });

    it("rejects pids threshold out of range", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1" });

      const handler = handlers.get("monitor::set-alert")!;
      await expect(handler({ id: "sbx_1", metric: "pids", threshold: 300 })).rejects.toThrow("pids threshold must be between 1 and 256");
    });

    it("rejects missing sandbox", async () => {
      const handler = handlers.get("monitor::set-alert")!;
      await expect(handler({ id: "sbx_missing", metric: "cpu", threshold: 50 })).rejects.toThrow("Sandbox not found");
    });
  });

  describe("monitor::list-alerts", () => {
    it("returns alerts filtered by sandbox", async () => {
      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_1", { id: "alrt_1", sandboxId: "sbx_1", metric: "cpu" });
      kvStore.get("alert")!.set("alrt_2", { id: "alrt_2", sandboxId: "sbx_2", metric: "memory" });
      kvStore.get("alert")!.set("alrt_3", { id: "alrt_3", sandboxId: "sbx_1", metric: "pids" });

      const handler = handlers.get("monitor::list-alerts")!;
      const result = await handler({ id: "sbx_1" });

      expect(result.alerts).toHaveLength(2);
      expect(result.alerts.every((a: any) => a.sandboxId === "sbx_1")).toBe(true);
    });

    it("returns empty array for sandbox with no alerts", async () => {
      const handler = handlers.get("monitor::list-alerts")!;
      const result = await handler({ id: "sbx_none" });

      expect(result.alerts).toHaveLength(0);
    });
  });

  describe("monitor::delete-alert", () => {
    it("deletes an existing alert", async () => {
      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_1", { id: "alrt_1", sandboxId: "sbx_1" });

      const handler = handlers.get("monitor::delete-alert")!;
      const result = await handler({ alertId: "alrt_1" });

      expect(result.deleted).toBe("alrt_1");
      expect(kvStore.get("alert")!.has("alrt_1")).toBe(false);
    });

    it("throws for non-existent alert", async () => {
      const handler = handlers.get("monitor::delete-alert")!;
      await expect(handler({ alertId: "alrt_missing" })).rejects.toThrow("Alert not found");
    });
  });

  describe("monitor::history", () => {
    it("returns alert events for a sandbox", async () => {
      if (!kvStore.has("alert_event")) kvStore.set("alert_event", new Map());
      kvStore.get("alert_event")!.set("aevt_1", {
        alertId: "alrt_1",
        sandboxId: "sbx_1",
        metric: "cpu",
        value: 95,
        threshold: 80,
        action: "notify",
        timestamp: 1000,
      });
      kvStore.get("alert_event")!.set("aevt_2", {
        alertId: "alrt_2",
        sandboxId: "sbx_2",
        metric: "memory",
        value: 92,
        threshold: 90,
        action: "pause",
        timestamp: 2000,
      });

      const handler = handlers.get("monitor::history")!;
      const result = await handler({ id: "sbx_1" });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].sandboxId).toBe("sbx_1");
      expect(result.total).toBe(1);
    });

    it("respects limit parameter", async () => {
      if (!kvStore.has("alert_event")) kvStore.set("alert_event", new Map());
      for (let i = 0; i < 10; i++) {
        kvStore.get("alert_event")!.set(`aevt_${i}`, {
          alertId: `alrt_${i}`,
          sandboxId: "sbx_1",
          metric: "cpu",
          value: 90 + i,
          threshold: 80,
          action: "notify",
          timestamp: i * 1000,
        });
      }

      const handler = handlers.get("monitor::history")!;
      const result = await handler({ id: "sbx_1", limit: 3 });

      expect(result.events).toHaveLength(3);
      expect(result.total).toBe(10);
    });
  });

  describe("monitor::check", () => {
    it("triggers alert when threshold exceeded", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_1", {
        id: "alrt_1",
        sandboxId: "sbx_1",
        metric: "cpu",
        threshold: 80,
        action: "pause",
        triggered: false,
        createdAt: Date.now(),
      });

      const mockContainerRef = { id: "container-1" };
      mockGetDocker.mockReturnValue({
        getContainer: () => mockContainerRef,
      });
      mockGetContainerStats.mockResolvedValue({
        sandboxId: "sbx_1",
        cpuPercent: 95,
        memoryUsageMb: 256,
        memoryLimitMb: 512,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 5,
      });

      const handler = handlers.get("monitor::check")!;
      const result = await handler();

      expect(result.checked).toBe(1);
      expect(result.triggered).toBe(1);
      expect(sdk.trigger).toHaveBeenCalledWith("sandbox::pause", { id: "sbx_1" });
    });

    it("does not trigger when below threshold", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_1", {
        id: "alrt_1",
        sandboxId: "sbx_1",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      });

      const mockContainerRef = { id: "container-1" };
      mockGetDocker.mockReturnValue({
        getContainer: () => mockContainerRef,
      });
      mockGetContainerStats.mockResolvedValue({
        sandboxId: "sbx_1",
        cpuPercent: 50,
        memoryUsageMb: 256,
        memoryLimitMb: 512,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 5,
      });

      const handler = handlers.get("monitor::check")!;
      const result = await handler();

      expect(result.checked).toBe(1);
      expect(result.triggered).toBe(0);
    });

    it("triggers kill action", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_1", {
        id: "alrt_1",
        sandboxId: "sbx_1",
        metric: "memory",
        threshold: 90,
        action: "kill",
        triggered: false,
        createdAt: Date.now(),
      });

      const mockContainerRef = { id: "container-1" };
      mockGetDocker.mockReturnValue({
        getContainer: () => mockContainerRef,
      });
      mockGetContainerStats.mockResolvedValue({
        sandboxId: "sbx_1",
        cpuPercent: 50,
        memoryUsageMb: 480,
        memoryLimitMb: 512,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 5,
      });

      const handler = handlers.get("monitor::check")!;
      await handler();

      expect(sdk.trigger).toHaveBeenCalledWith("sandbox::kill", { id: "sbx_1" });
    });

    it("skips non-running sandboxes", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "paused" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_1", {
        id: "alrt_1",
        sandboxId: "sbx_1",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      });

      const handler = handlers.get("monitor::check")!;
      const result = await handler();

      expect(result.checked).toBe(0);
      expect(result.triggered).toBe(0);
    });
  });
});
