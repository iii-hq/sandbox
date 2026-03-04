import { describe, it, expect, vi, beforeEach } from "vitest";
import { VolumeManager } from "../../packages/sdk/src/volume.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("VolumeManager (SDK)", () => {
  let mockClient: HttpClient;
  let volumes: VolumeManager;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient;
    volumes = new VolumeManager(mockClient);
  });

  describe("create", () => {
    it("calls correct endpoint with name", async () => {
      const expected = {
        id: "vol_abc",
        name: "my-data",
        dockerVolumeName: "iii-vol-vol_abc",
        createdAt: Date.now(),
      };
      (mockClient.post as any).mockResolvedValue(expected);

      const result = await volumes.create("my-data");

      expect(mockClient.post).toHaveBeenCalledWith("/sandbox/volumes", {
        name: "my-data",
        driver: undefined,
      });
      expect(result).toEqual(expected);
    });

    it("passes custom driver", async () => {
      (mockClient.post as any).mockResolvedValue({ id: "vol_abc" });

      await volumes.create("nfs-data", "nfs");

      expect(mockClient.post).toHaveBeenCalledWith("/sandbox/volumes", {
        name: "nfs-data",
        driver: "nfs",
      });
    });
  });

  describe("list", () => {
    it("calls correct endpoint", async () => {
      const expected = { volumes: [{ id: "vol_1", name: "data" }] };
      (mockClient.get as any).mockResolvedValue(expected);

      const result = await volumes.list();

      expect(mockClient.get).toHaveBeenCalledWith("/sandbox/volumes");
      expect(result.volumes).toHaveLength(1);
    });
  });

  describe("delete", () => {
    it("calls correct endpoint", async () => {
      (mockClient.del as any).mockResolvedValue({ deleted: "vol_abc" });

      const result = await volumes.delete("vol_abc");

      expect(mockClient.del).toHaveBeenCalledWith("/sandbox/volumes/vol_abc");
      expect(result.deleted).toBe("vol_abc");
    });
  });

  describe("attach", () => {
    it("calls correct endpoint", async () => {
      const expected = { attached: true, mountPath: "/data" };
      (mockClient.post as any).mockResolvedValue(expected);

      const result = await volumes.attach("vol_abc", "sbx_123", "/data");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/volumes/vol_abc/attach",
        { sandboxId: "sbx_123", mountPath: "/data" },
      );
      expect(result.attached).toBe(true);
    });
  });

  describe("detach", () => {
    it("calls correct endpoint", async () => {
      (mockClient.post as any).mockResolvedValue({ detached: true });

      const result = await volumes.detach("vol_abc");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/volumes/vol_abc/detach",
      );
      expect(result.detached).toBe(true);
    });

    it("propagates errors", async () => {
      (mockClient.post as any).mockRejectedValue(new Error("POST failed: 404"));

      await expect(volumes.detach("vol_missing")).rejects.toThrow(
        "POST failed: 404",
      );
    });
  });
});
