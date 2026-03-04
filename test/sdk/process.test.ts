import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProcessManager } from "../../packages/sdk/src/process.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("ProcessManager", () => {
  let mockClient: HttpClient;
  const sandboxId = "sbx_test123";

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient;
  });

  describe("list", () => {
    it("calls correct endpoint", async () => {
      const expected = {
        processes: [
          { pid: 1, user: "root", cpu: "0.1", memory: "0.5", command: "/bin/sh" },
        ],
      };
      (mockClient.get as any).mockResolvedValue(expected);
      const pm = new ProcessManager(mockClient, sandboxId);

      const result = await pm.list();

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/processes`,
      );
      expect(result).toEqual(expected);
    });

    it("propagates errors", async () => {
      (mockClient.get as any).mockRejectedValue(new Error("GET failed: 404"));
      const pm = new ProcessManager(mockClient, sandboxId);

      await expect(pm.list()).rejects.toThrow("GET failed: 404");
    });
  });

  describe("kill", () => {
    it("calls correct endpoint with pid", async () => {
      const expected = { killed: 42, signal: "TERM" };
      (mockClient.post as any).mockResolvedValue(expected);
      const pm = new ProcessManager(mockClient, sandboxId);

      const result = await pm.kill(42);

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/processes/kill`,
        { pid: 42, signal: undefined },
      );
      expect(result).toEqual(expected);
    });

    it("passes signal when provided", async () => {
      const expected = { killed: 42, signal: "KILL" };
      (mockClient.post as any).mockResolvedValue(expected);
      const pm = new ProcessManager(mockClient, sandboxId);

      const result = await pm.kill(42, "KILL");

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/processes/kill`,
        { pid: 42, signal: "KILL" },
      );
      expect(result).toEqual(expected);
    });
  });

  describe("top", () => {
    it("calls correct endpoint", async () => {
      const expected = {
        processes: [
          { pid: 1, cpu: "0.0", mem: "0.1", vsz: 2384, rss: 1280, command: "/bin/sh" },
        ],
      };
      (mockClient.get as any).mockResolvedValue(expected);
      const pm = new ProcessManager(mockClient, sandboxId);

      const result = await pm.top();

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/processes/top`,
      );
      expect(result).toEqual(expected);
    });

    it("propagates errors", async () => {
      (mockClient.get as any).mockRejectedValue(new Error("GET failed: 500"));
      const pm = new ProcessManager(mockClient, sandboxId);

      await expect(pm.top()).rejects.toThrow("GET failed: 500");
    });
  });
});
