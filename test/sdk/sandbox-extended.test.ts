import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../../packages/sdk/src/sandbox.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("Sandbox Extended", () => {
  let mockClient: HttpClient;

  const baseInfo = {
    id: "sbx_abc123",
    name: "my-sandbox",
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

  describe("id getter", () => {
    it("returns info.id", () => {
      const sbx = new Sandbox(mockClient, baseInfo);
      expect(sbx.id).toBe("sbx_abc123");
    });

    it("reflects updated info.id after mutation", () => {
      const info = { ...baseInfo };
      const sbx = new Sandbox(mockClient, info);
      info.id = "sbx_changed";
      expect(sbx.id).toBe("sbx_changed");
    });
  });

  describe("status getter", () => {
    it("returns info.status", () => {
      const sbx = new Sandbox(mockClient, baseInfo);
      expect(sbx.status).toBe("running");
    });

    it("reflects status changes on info object", () => {
      const info = { ...baseInfo };
      const sbx = new Sandbox(mockClient, info);
      info.status = "paused" as any;
      expect(sbx.status).toBe("paused");
    });
  });

  describe("exec", () => {
    it("sends command to correct endpoint", async () => {
      const expected = {
        exitCode: 0,
        stdout: "hello",
        stderr: "",
        duration: 100,
      };
      (mockClient.post as any).mockResolvedValue(expected);
      const sbx = new Sandbox(mockClient, baseInfo);

      const result = await sbx.exec("echo hello");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/exec",
        { command: "echo hello", timeout: undefined },
      );
      expect(result).toEqual(expected);
    });

    it("passes optional timeout", async () => {
      (mockClient.post as any).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 10,
      });
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.exec("sleep 5", 30);

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/exec",
        { command: "sleep 5", timeout: 30 },
      );
    });

    it("omits timeout when not provided", async () => {
      (mockClient.post as any).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 10,
      });
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.exec("ls");

      const call = (mockClient.post as any).mock.calls[0];
      expect(call[1].timeout).toBeUndefined();
    });

    it("propagates client errors", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 500"));
      const sbx = new Sandbox(mockClient, baseInfo);

      await expect(sbx.exec("bad")).rejects.toThrow("POST failed: 500");
    });

    it("returns non-zero exit code results", async () => {
      const failed = {
        exitCode: 1,
        stdout: "",
        stderr: "command not found",
        duration: 5,
      };
      (mockClient.post as any).mockResolvedValue(failed);
      const sbx = new Sandbox(mockClient, baseInfo);

      const result = await sbx.exec("nonexistent");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("command not found");
    });
  });

  describe("execStream", () => {
    it("calls stream endpoint and parses chunks", async () => {
      const mockGen = (async function* () {
        yield '{"type":"stdout","data":"line1\\n","timestamp":1}';
        yield '{"type":"stdout","data":"line2\\n","timestamp":2}';
        yield '{"type":"exit","data":"0","timestamp":3}';
      })();
      (mockClient.stream as any).mockReturnValue(mockGen);
      const sbx = new Sandbox(mockClient, baseInfo);

      const gen = await sbx.execStream("cat file.txt");
      const chunks = [];
      for await (const chunk of gen) chunks.push(chunk);

      expect(mockClient.stream).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/exec/stream",
        { command: "cat file.txt" },
      );
      expect(chunks).toHaveLength(3);
    });

    it("returns chunks with correct types", async () => {
      const mockGen = (async function* () {
        yield '{"type":"stderr","data":"warn\\n","timestamp":1}';
        yield '{"type":"exit","data":"1","timestamp":2}';
      })();
      (mockClient.stream as any).mockReturnValue(mockGen);
      const sbx = new Sandbox(mockClient, baseInfo);

      const gen = await sbx.execStream("bad-cmd");
      const chunks = [];
      for await (const chunk of gen) chunks.push(chunk);

      expect(chunks[0].type).toBe("stderr");
      expect(chunks[1].type).toBe("exit");
    });

    it("handles empty stream", async () => {
      const mockGen = (async function* () {})();
      (mockClient.stream as any).mockReturnValue(mockGen);
      const sbx = new Sandbox(mockClient, baseInfo);

      const gen = await sbx.execStream("true");
      const chunks = [];
      for await (const chunk of gen) chunks.push(chunk);

      expect(chunks).toHaveLength(0);
    });
  });

  describe("pause", () => {
    it("calls pause endpoint", async () => {
      (mockClient.post as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.pause();

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/pause",
      );
    });

    it("propagates errors", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 400"));
      const sbx = new Sandbox(mockClient, baseInfo);

      await expect(sbx.pause()).rejects.toThrow("POST failed: 400");
    });
  });

  describe("resume", () => {
    it("calls resume endpoint", async () => {
      (mockClient.post as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.resume();

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/resume",
      );
    });

    it("propagates errors", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 409"));
      const sbx = new Sandbox(mockClient, baseInfo);

      await expect(sbx.resume()).rejects.toThrow("POST failed: 409");
    });
  });

  describe("kill", () => {
    it("calls DELETE endpoint", async () => {
      (mockClient.del as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.kill();

      expect(mockClient.del).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123",
      );
    });

    it("propagates errors", async () => {
      (mockClient.del as any).mockRejectedValue(
        new Error("DELETE failed: 404"),
      );
      const sbx = new Sandbox(mockClient, baseInfo);

      await expect(sbx.kill()).rejects.toThrow("DELETE failed: 404");
    });
  });

  describe("metrics", () => {
    it("calls metrics endpoint and returns data", async () => {
      const metricsData = {
        sandboxId: "sbx_abc123",
        cpuPercent: 12.5,
        memoryUsageMb: 256,
        memoryLimitMb: 512,
        networkRxBytes: 1024,
        networkTxBytes: 2048,
        pids: 5,
      };
      (mockClient.get as any).mockResolvedValue(metricsData);
      const sbx = new Sandbox(mockClient, baseInfo);

      const result = await sbx.metrics();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/metrics",
      );
      expect(result).toEqual(metricsData);
      expect(result.cpuPercent).toBe(12.5);
      expect(result.memoryUsageMb).toBe(256);
    });

    it("propagates errors", async () => {
      (mockClient.get as any).mockRejectedValue(new Error("GET failed: 500"));
      const sbx = new Sandbox(mockClient, baseInfo);

      await expect(sbx.metrics()).rejects.toThrow("GET failed: 500");
    });
  });

  describe("refresh", () => {
    it("fetches updated info and mutates in place", async () => {
      const updated = {
        ...baseInfo,
        status: "paused" as const,
        expiresAt: Date.now() + 7200000,
      };
      (mockClient.get as any).mockResolvedValue(updated);
      const sbx = new Sandbox(mockClient, { ...baseInfo });

      const result = await sbx.refresh();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123",
      );
      expect(result.status).toBe("paused");
      expect(sbx.status).toBe("paused");
      expect(sbx.info.expiresAt).toBe(updated.expiresAt);
    });

    it("returns the updated info", async () => {
      const updated = { ...baseInfo, name: "renamed" };
      (mockClient.get as any).mockResolvedValue(updated);
      const sbx = new Sandbox(mockClient, { ...baseInfo });

      const result = await sbx.refresh();

      expect(result.name).toBe("renamed");
    });

    it("keeps original info reference", async () => {
      const info = { ...baseInfo };
      const sbx = new Sandbox(mockClient, info);
      const updated = { ...baseInfo, status: "stopped" as any };
      (mockClient.get as any).mockResolvedValue(updated);

      await sbx.refresh();

      expect(info.status).toBe("stopped");
    });

    it("propagates errors", async () => {
      (mockClient.get as any).mockRejectedValue(new Error("GET failed: 404"));
      const sbx = new Sandbox(mockClient, baseInfo);

      await expect(sbx.refresh()).rejects.toThrow("GET failed: 404");
    });
  });

  describe("filesystem and interpreter", () => {
    it("filesystem is initialized", () => {
      const sbx = new Sandbox(mockClient, baseInfo);
      expect(sbx.filesystem).toBeDefined();
    });

    it("interpreter is initialized", () => {
      const sbx = new Sandbox(mockClient, baseInfo);
      expect(sbx.interpreter).toBeDefined();
    });

    it("filesystem persists across accesses", () => {
      const sbx = new Sandbox(mockClient, baseInfo);
      const ref1 = sbx.filesystem;
      const ref2 = sbx.filesystem;
      expect(ref1).toBe(ref2);
    });

    it("interpreter persists across accesses", () => {
      const sbx = new Sandbox(mockClient, baseInfo);
      const ref1 = sbx.interpreter;
      const ref2 = sbx.interpreter;
      expect(ref1).toBe(ref2);
    });

    it("filesystem uses sandbox id for requests", async () => {
      (mockClient.post as any).mockResolvedValue([]);
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.filesystem.list();

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/files/list",
        { path: "/workspace" },
      );
    });

    it("interpreter uses sandbox id for requests", async () => {
      (mockClient.post as any).mockResolvedValue({
        output: "2",
        executionTime: 10,
      });
      const sbx = new Sandbox(mockClient, baseInfo);

      await sbx.interpreter.run("print(1+1)");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_abc123/interpret/execute",
        { code: "print(1+1)", language: "python" },
      );
    });
  });

  describe("endpoint routing with different ids", () => {
    it("uses correct id in all endpoint paths", async () => {
      const customInfo = { ...baseInfo, id: "sbx_xyz789" };
      (mockClient.post as any).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 10,
      });
      (mockClient.get as any).mockResolvedValue({});
      (mockClient.del as any).mockResolvedValue(undefined);
      const sbx = new Sandbox(mockClient, customInfo);

      await sbx.exec("ls");
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_xyz789/exec",
        expect.anything(),
      );

      await sbx.metrics();
      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_xyz789/metrics",
      );

      await sbx.kill();
      expect(mockClient.del).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_xyz789",
      );
    });
  });
});
