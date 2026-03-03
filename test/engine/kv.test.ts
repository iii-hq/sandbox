import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateKV } from "../../packages/engine/src/state/kv.js";

describe("StateKV", () => {
  let kv: StateKV;
  let mockSdk: any;

  beforeEach(() => {
    mockSdk = {
      trigger: vi.fn(),
    };
    kv = new StateKV(mockSdk);
  });

  describe("get", () => {
    it("calls state::get with scope and key", async () => {
      mockSdk.trigger.mockResolvedValue({ data: "test" });
      const result = await kv.get("sandbox", "id1");
      expect(mockSdk.trigger).toHaveBeenCalledWith("state::get", {
        scope: "sandbox",
        key: "id1",
      });
      expect(result).toEqual({ data: "test" });
    });

    it("returns null for missing key", async () => {
      mockSdk.trigger.mockResolvedValue(null);
      expect(await kv.get("sandbox", "missing")).toBeNull();
    });

    it("returns typed data", async () => {
      mockSdk.trigger.mockResolvedValue({ id: "sbx_1", status: "running" });
      const result = await kv.get<{ id: string; status: string }>(
        "sandbox",
        "sbx_1",
      );
      expect(result?.id).toBe("sbx_1");
      expect(result?.status).toBe("running");
    });

    it("passes different scopes correctly", async () => {
      mockSdk.trigger.mockResolvedValue({});
      await kv.get("metrics", "key1");
      expect(mockSdk.trigger).toHaveBeenCalledWith("state::get", {
        scope: "metrics",
        key: "key1",
      });
    });

    it("propagates sdk errors", async () => {
      mockSdk.trigger.mockRejectedValue(new Error("connection lost"));
      await expect(kv.get("sandbox", "id1")).rejects.toThrow("connection lost");
    });
  });

  describe("set", () => {
    it("calls state::set with scope, key, value", async () => {
      const data = { id: "1", name: "test" };
      mockSdk.trigger.mockResolvedValue(data);
      const result = await kv.set("sandbox", "id1", data);
      expect(mockSdk.trigger).toHaveBeenCalledWith("state::set", {
        scope: "sandbox",
        key: "id1",
        value: data,
      });
      expect(result).toEqual(data);
    });

    it("handles complex nested data", async () => {
      const data = { config: { env: { NODE_ENV: "prod" }, memory: 1024 } };
      mockSdk.trigger.mockResolvedValue(data);
      const result = await kv.set("sandbox", "id2", data);
      expect(result).toEqual(data);
    });

    it("propagates sdk errors", async () => {
      mockSdk.trigger.mockRejectedValue(new Error("write failed"));
      await expect(kv.set("sandbox", "id1", {})).rejects.toThrow(
        "write failed",
      );
    });
  });

  describe("delete", () => {
    it("calls state::delete with scope and key", async () => {
      mockSdk.trigger.mockResolvedValue(undefined);
      await kv.delete("sandbox", "id1");
      expect(mockSdk.trigger).toHaveBeenCalledWith("state::delete", {
        scope: "sandbox",
        key: "id1",
      });
    });

    it("propagates sdk errors", async () => {
      mockSdk.trigger.mockRejectedValue(new Error("delete failed"));
      await expect(kv.delete("sandbox", "id1")).rejects.toThrow(
        "delete failed",
      );
    });
  });

  describe("list", () => {
    it("calls state::list with scope", async () => {
      mockSdk.trigger.mockResolvedValue([{ id: "1" }, { id: "2" }]);
      const result = await kv.list("sandbox");
      expect(mockSdk.trigger).toHaveBeenCalledWith("state::list", {
        scope: "sandbox",
      });
      expect(result).toHaveLength(2);
    });

    it("returns empty array for empty scope", async () => {
      mockSdk.trigger.mockResolvedValue([]);
      expect(await kv.list("empty")).toEqual([]);
    });

    it("returns typed array", async () => {
      const items = [
        { id: "sbx_1", status: "running" },
        { id: "sbx_2", status: "paused" },
      ];
      mockSdk.trigger.mockResolvedValue(items);
      const result = await kv.list<{ id: string; status: string }>("sandbox");
      expect(result[0].id).toBe("sbx_1");
      expect(result[1].status).toBe("paused");
    });

    it("propagates sdk errors", async () => {
      mockSdk.trigger.mockRejectedValue(new Error("list failed"));
      await expect(kv.list("sandbox")).rejects.toThrow("list failed");
    });
  });
});
