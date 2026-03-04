import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueueManager } from "../../packages/sdk/src/queue.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("QueueManager", () => {
  let mockClient: HttpClient;
  let queue: QueueManager;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient;
    queue = new QueueManager(mockClient, "sbx_test123");
  });

  describe("submit", () => {
    it("calls correct endpoint with command", async () => {
      const job = {
        id: "job_abc",
        sandboxId: "sbx_test123",
        command: "echo hello",
        status: "pending",
        retries: 0,
        maxRetries: 3,
        createdAt: Date.now(),
      };
      (mockClient.post as any).mockResolvedValue(job);

      const result = await queue.submit("echo hello");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/exec/queue",
        { command: "echo hello" },
      );
      expect(result).toEqual(job);
    });

    it("passes maxRetries and timeout options", async () => {
      (mockClient.post as any).mockResolvedValue({ id: "job_abc" });

      await queue.submit("ls", { maxRetries: 5, timeout: 30 });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/exec/queue",
        { command: "ls", maxRetries: 5, timeout: 30 },
      );
    });
  });

  describe("status", () => {
    it("calls correct endpoint", async () => {
      const job = { id: "job_abc", status: "completed" };
      (mockClient.get as any).mockResolvedValue(job);

      const result = await queue.status("job_abc");

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/queue/job_abc/status",
      );
      expect(result).toEqual(job);
    });
  });

  describe("cancel", () => {
    it("calls correct endpoint", async () => {
      (mockClient.post as any).mockResolvedValue({ cancelled: "job_abc" });

      const result = await queue.cancel("job_abc");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/queue/job_abc/cancel",
      );
      expect(result).toEqual({ cancelled: "job_abc" });
    });
  });

  describe("dlq", () => {
    it("calls correct endpoint without limit", async () => {
      const dlqResult = { jobs: [], total: 0 };
      (mockClient.get as any).mockResolvedValue(dlqResult);

      const result = await queue.dlq();

      expect(mockClient.get).toHaveBeenCalledWith("/sandbox/queue/dlq");
      expect(result).toEqual(dlqResult);
    });

    it("calls correct endpoint with limit", async () => {
      (mockClient.get as any).mockResolvedValue({ jobs: [], total: 0 });

      await queue.dlq(10);

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/queue/dlq?limit=10",
      );
    });
  });
});
