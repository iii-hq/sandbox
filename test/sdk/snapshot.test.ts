import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../../packages/sdk/src/sandbox.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("Sandbox Snapshots (SDK)", () => {
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

  describe("snapshot", () => {
    it("calls correct endpoint with name", async () => {
      const expected = {
        id: "snap_abc",
        sandboxId: "sbx_test123",
        name: "checkpoint",
        imageId: "sha256:abc",
        size: 100,
        createdAt: Date.now(),
      };
      (mockClient.post as any).mockResolvedValue(expected);
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.snapshot("checkpoint");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/snapshots",
        { name: "checkpoint" },
      );
      expect(result).toEqual(expected);
    });

    it("calls correct endpoint without name", async () => {
      (mockClient.post as any).mockResolvedValue({ id: "snap_abc" });
      const sbx = new Sandbox(mockClient, info);

      await sbx.snapshot();

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/snapshots",
        { name: undefined },
      );
    });

    it("propagates errors", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 500"));
      const sbx = new Sandbox(mockClient, info);

      await expect(sbx.snapshot()).rejects.toThrow("POST failed: 500");
    });
  });

  describe("restore", () => {
    it("calls correct endpoint", async () => {
      const expected = { ...info, image: "sha256:abc" };
      (mockClient.post as any).mockResolvedValue(expected);
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.restore("snap_abc");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/snapshots/restore",
        { snapshotId: "snap_abc" },
      );
      expect(result).toEqual(expected);
    });

    it("propagates errors", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 404"));
      const sbx = new Sandbox(mockClient, info);

      await expect(sbx.restore("snap_missing")).rejects.toThrow("POST failed: 404");
    });
  });

  describe("listSnapshots", () => {
    it("calls correct endpoint", async () => {
      const expected = {
        snapshots: [
          {
            id: "snap_1",
            sandboxId: "sbx_test123",
            name: "snap1",
            imageId: "sha256:1",
            size: 100,
            createdAt: Date.now(),
          },
        ],
      };
      (mockClient.get as any).mockResolvedValue(expected);
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.listSnapshots();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test123/snapshots",
      );
      expect(result.snapshots).toHaveLength(1);
    });

    it("returns empty list when no snapshots", async () => {
      (mockClient.get as any).mockResolvedValue({ snapshots: [] });
      const sbx = new Sandbox(mockClient, info);

      const result = await sbx.listSnapshots();

      expect(result.snapshots).toEqual([]);
    });
  });
});
