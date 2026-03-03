import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../../packages/sdk/src/sandbox.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("Sandbox", () => {
  let mockClient: HttpClient;
  const info = {
    id: "sbx_test123",
    name: "test",
    image: "python:3.12-slim",
    status: "running" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient;
  });

  describe("constructor and properties", () => {
    it("exposes id from info", () => {
      const sbx = new Sandbox(mockClient, info);
      expect(sbx.id).toBe("sbx_test123");
    });

    it("exposes status from info", () => {
      const sbx = new Sandbox(mockClient, info);
      expect(sbx.status).toBe("running");
    });

    it("creates filesystem instance", () => {
      const sbx = new Sandbox(mockClient, info);
      expect(sbx.filesystem).toBeDefined();
    });

    it("creates interpreter instance", () => {
      const sbx = new Sandbox(mockClient, info);
      expect(sbx.interpreter).toBeDefined();
    });

    it("info is mutable for refresh", () => {
      const sbx = new Sandbox(mockClient, info);
      sbx.info.status = "paused";
      expect(sbx.status).toBe("paused");
    });
  });

  describe("exec", () => {
    it("calls correct endpoint", async () => {
      const expected = {
        exitCode: 0,
        stdout: "hello",
        stderr: "",
        duration: 100,
      };
      (mockClient.post as any).mockResolvedValue(expected);
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.exec("echo hello");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/exec",
        { command: "echo hello", timeout: undefined },
      );
      expect(result).toEqual(expected);
    });

    it("passes timeout when provided", async () => {
      (mockClient.post as any).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
      });
      const sbx = new Sandbox(mockClient, info);

      await sbx.exec("sleep 5", 10);

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/exec",
        { command: "sleep 5", timeout: 10 },
      );
    });

    it("propagates errors from client", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 500"));
      const sbx = new Sandbox(mockClient, info);

      await expect(sbx.exec("bad")).rejects.toThrow("POST failed: 500");
    });
  });

  describe("execStream", () => {
    it("calls stream endpoint and returns async generator", async () => {
      const mockGen = (async function* () {
        yield '{"type":"stdout","data":"hello","timestamp":1}';
        yield '{"type":"exit","data":"0","timestamp":2}';
      })();
      (mockClient.stream as any).mockReturnValue(mockGen);
      const sbx = new Sandbox(mockClient, info);

      const gen = await sbx.execStream("echo hello");
      const chunks = [];
      for await (const chunk of gen) chunks.push(chunk);

      expect(mockClient.stream).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/exec/stream",
        { command: "echo hello" },
      );
      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe("stdout");
      expect(chunks[1].type).toBe("exit");
    });
  });

  describe("lifecycle operations", () => {
    it("pause calls correct endpoint", async () => {
      (mockClient.post as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, info);

      await sbx.pause();

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/pause",
      );
    });

    it("resume calls correct endpoint", async () => {
      (mockClient.post as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, info);

      await sbx.resume();

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/resume",
      );
    });

    it("kill calls DELETE endpoint", async () => {
      (mockClient.del as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, info);

      await sbx.kill();

      expect(mockClient.del).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123",
      );
    });
  });

  describe("metrics", () => {
    it("calls metrics endpoint", async () => {
      const metrics = {
        sandboxId: "sbx_test123",
        cpuPercent: 5.2,
        memoryUsageMb: 128,
        memoryLimitMb: 512,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 3,
      };
      (mockClient.get as any).mockResolvedValue(metrics);
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.metrics();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/metrics",
      );
      expect(result).toEqual(metrics);
    });
  });

  describe("refresh", () => {
    it("updates info from server", async () => {
      const updated = { ...info, status: "paused" as const };
      (mockClient.get as any).mockResolvedValue(updated);
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.refresh();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123",
      );
      expect(result.status).toBe("paused");
      expect(sbx.status).toBe("paused");
    });
  });
});
