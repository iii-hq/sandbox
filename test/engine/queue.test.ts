import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

import { registerQueueFunctions } from "../../packages/engine/src/functions/queue.js";

describe("Queue Functions", () => {
  let handlers: Map<string, Function>;
  let store: Record<string, Record<string, any>>;
  let triggerMock: ReturnType<typeof vi.fn>;

  const config = {
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
      queue: {},
    };

    triggerMock = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      duration: 50,
    });

    const kv = {
      get: vi.fn(
        async (scope: string, key: string) => store[scope]?.[key] ?? null,
      ),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!store[scope]) store[scope] = {};
        store[scope][key] = value;
      }),
      delete: vi.fn(),
      list: vi.fn(async (scope: string) => Object.values(store[scope] ?? {})),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: triggerMock,
    };

    registerQueueFunctions(sdk, kv as any, config as any);
  });

  describe("queue::submit", () => {
    it("creates a pending job for a running sandbox", async () => {
      const submit = handlers.get("queue::submit")!;
      const job = await submit({ id: "sbx_test", command: "echo hello" });

      expect(job.id).toMatch(/^job_/);
      expect(job.sandboxId).toBe("sbx_test");
      expect(job.command).toBe("echo hello");
      expect(job.status).toBe("pending");
      expect(job.retries).toBe(0);
      expect(job.maxRetries).toBe(3);
      expect(job.createdAt).toBeGreaterThan(0);
    });

    it("uses custom maxRetries", async () => {
      const submit = handlers.get("queue::submit")!;
      const job = await submit({
        id: "sbx_test",
        command: "ls",
        maxRetries: 5,
      });

      expect(job.maxRetries).toBe(5);
    });

    it("stores job in KV", async () => {
      const submit = handlers.get("queue::submit")!;
      const job = await submit({ id: "sbx_test", command: "echo test" });

      expect(store.queue[job.id]).toBeDefined();
      expect(store.queue[job.id].command).toBe("echo test");
    });

    it("throws for non-existent sandbox", async () => {
      const submit = handlers.get("queue::submit")!;
      await expect(
        submit({ id: "sbx_missing", command: "ls" }),
      ).rejects.toThrow("Sandbox not found");
    });

    it("throws for non-running sandbox", async () => {
      const submit = handlers.get("queue::submit")!;
      await expect(submit({ id: "sbx_paused", command: "ls" })).rejects.toThrow(
        "not running",
      );
    });
  });

  describe("queue::status", () => {
    it("returns job status", async () => {
      const submit = handlers.get("queue::submit")!;
      const created = await submit({ id: "sbx_test", command: "echo hello" });

      const status = handlers.get("queue::status")!;
      const job = await status({ jobId: created.id });

      expect(job.id).toBe(created.id);
      expect(job.sandboxId).toBe("sbx_test");
    });

    it("throws for non-existent job", async () => {
      const status = handlers.get("queue::status")!;
      await expect(status({ jobId: "job_missing" })).rejects.toThrow(
        "Queue job not found",
      );
    });
  });

  describe("queue::cancel", () => {
    it("cancels a pending job", async () => {
      const submit = handlers.get("queue::submit")!;
      const created = await submit({ id: "sbx_test", command: "sleep 100" });

      const cancel = handlers.get("queue::cancel")!;
      const result = await cancel({ jobId: created.id });

      expect(result.cancelled).toBe(created.id);
      expect(store.queue[created.id].status).toBe("cancelled");
      expect(store.queue[created.id].completedAt).toBeGreaterThan(0);
    });

    it("throws for non-existent job", async () => {
      const cancel = handlers.get("queue::cancel")!;
      await expect(cancel({ jobId: "job_missing" })).rejects.toThrow(
        "Queue job not found",
      );
    });

    it("throws for non-pending job", async () => {
      const submit = handlers.get("queue::submit")!;
      const created = await submit({ id: "sbx_test", command: "ls" });
      store.queue[created.id].status = "running";

      const cancel = handlers.get("queue::cancel")!;
      await expect(cancel({ jobId: created.id })).rejects.toThrow(
        "not pending",
      );
    });
  });

  describe("queue::dlq", () => {
    it("returns empty list when no failed jobs", async () => {
      const dlq = handlers.get("queue::dlq")!;
      const result = await dlq({});

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("returns only failed jobs", async () => {
      store.queue = {
        job_1: { id: "job_1", status: "failed", error: "timeout" },
        job_2: { id: "job_2", status: "completed" },
        job_3: { id: "job_3", status: "failed", error: "exit 1" },
      };

      const dlq = handlers.get("queue::dlq")!;
      const result = await dlq({});

      expect(result.total).toBe(2);
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs.every((j: any) => j.status === "failed")).toBe(true);
    });

    it("respects limit and offset", async () => {
      store.queue = {
        job_1: { id: "job_1", status: "failed" },
        job_2: { id: "job_2", status: "failed" },
        job_3: { id: "job_3", status: "failed" },
      };

      const dlq = handlers.get("queue::dlq")!;
      const result = await dlq({ limit: 1, offset: 1 });

      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(3);
    });
  });

  describe("queue::process", () => {
    it("processes a pending job successfully", async () => {
      const submit = handlers.get("queue::submit")!;
      const created = await submit({ id: "sbx_test", command: "echo hello" });

      const process = handlers.get("queue::process")!;
      const job = await process({ jobId: created.id });

      expect(job.status).toBe("completed");
      expect(job.result).toBeDefined();
      expect(job.result.exitCode).toBe(0);
      expect(job.completedAt).toBeGreaterThan(0);
    });

    it("retries on failure and stays pending", async () => {
      const submit = handlers.get("queue::submit")!;
      const created = await submit({ id: "sbx_test", command: "bad cmd" });

      triggerMock.mockRejectedValueOnce(new Error("command failed"));

      const process = handlers.get("queue::process")!;
      const job = await process({ jobId: created.id });

      expect(job.status).toBe("pending");
      expect(job.retries).toBe(1);
      expect(job.startedAt).toBeUndefined();
    });

    it("moves to failed (DLQ) after max retries", async () => {
      triggerMock.mockRejectedValue(new Error("always fails"));

      const submit = handlers.get("queue::submit")!;
      const created = await submit({
        id: "sbx_test",
        command: "bad",
        maxRetries: 1,
      });

      const process = handlers.get("queue::process")!;
      const job = await process({ jobId: created.id });

      expect(job.status).toBe("failed");
      expect(job.error).toBe("always fails");
      expect(job.retries).toBe(1);
      expect(job.completedAt).toBeGreaterThan(0);
    });

    it("skips non-pending jobs", async () => {
      const submit = handlers.get("queue::submit")!;
      const created = await submit({ id: "sbx_test", command: "echo" });
      store.queue[created.id].status = "completed";

      const process = handlers.get("queue::process")!;
      const job = await process({ jobId: created.id });

      expect(job.status).toBe("completed");
    });

    it("throws for non-existent job", async () => {
      const process = handlers.get("queue::process")!;
      await expect(process({ jobId: "job_missing" })).rejects.toThrow(
        "Queue job not found",
      );
    });
  });
});
