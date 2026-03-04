import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitorManager } from "../../packages/sdk/src/monitor.js";

describe("MonitorManager", () => {
  let mockClient: any;
  let monitor: MonitorManager;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
    };
    monitor = new MonitorManager(mockClient, "sbx_test");
  });

  describe("setAlert", () => {
    it("calls POST with correct params", async () => {
      const alert = {
        id: "alrt_1",
        sandboxId: "sbx_test",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      };
      mockClient.post.mockResolvedValue(alert);

      const result = await monitor.setAlert("cpu", 80, "notify");

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/alerts",
        { metric: "cpu", threshold: 80, action: "notify" },
      );
      expect(result).toEqual(alert);
    });

    it("works without action parameter", async () => {
      mockClient.post.mockResolvedValue({ id: "alrt_1" });

      await monitor.setAlert("memory", 90);

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/alerts",
        { metric: "memory", threshold: 90, action: undefined },
      );
    });
  });

  describe("listAlerts", () => {
    it("calls GET with correct path", async () => {
      const response = { alerts: [{ id: "alrt_1" }] };
      mockClient.get.mockResolvedValue(response);

      const result = await monitor.listAlerts();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/alerts",
      );
      expect(result).toEqual(response);
    });
  });

  describe("deleteAlert", () => {
    it("calls DELETE with correct path", async () => {
      mockClient.del.mockResolvedValue({ deleted: "alrt_1" });

      const result = await monitor.deleteAlert("alrt_1");

      expect(mockClient.del).toHaveBeenCalledWith("/sandbox/alerts/alrt_1");
      expect(result.deleted).toBe("alrt_1");
    });
  });

  describe("history", () => {
    it("calls GET without limit", async () => {
      const response = { events: [], total: 0 };
      mockClient.get.mockResolvedValue(response);

      const result = await monitor.history();

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/alerts/history",
      );
      expect(result).toEqual(response);
    });

    it("calls GET with limit query param", async () => {
      const response = { events: [{ alertId: "alrt_1" }], total: 5 };
      mockClient.get.mockResolvedValue(response);

      const result = await monitor.history(10);

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/alerts/history?limit=10",
      );
      expect(result).toEqual(response);
    });
  });
});
