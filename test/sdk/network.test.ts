import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkManager } from "../../packages/sdk/src/network.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("NetworkManager", () => {
  let mockClient: HttpClient;
  let manager: NetworkManager;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient;

    manager = new NetworkManager(mockClient);
  });

  it("create calls POST /sandbox/networks", async () => {
    const net = {
      id: "net_abc",
      name: "test",
      dockerNetworkId: "docker-123",
      sandboxes: [],
      createdAt: Date.now(),
    };
    (mockClient.post as any).mockResolvedValue(net);

    const result = await manager.create("test", "bridge");

    expect(mockClient.post).toHaveBeenCalledWith("/sandbox/networks", {
      name: "test",
      driver: "bridge",
    });
    expect(result.id).toBe("net_abc");
  });

  it("list calls GET /sandbox/networks", async () => {
    (mockClient.get as any).mockResolvedValue({ networks: [] });

    const result = await manager.list();

    expect(mockClient.get).toHaveBeenCalledWith("/sandbox/networks");
    expect(result.networks).toEqual([]);
  });

  it("connect calls POST /sandbox/networks/:id/connect", async () => {
    (mockClient.post as any).mockResolvedValue({ connected: true });

    const result = await manager.connect("net_abc", "sbx_123");

    expect(mockClient.post).toHaveBeenCalledWith(
      "/sandbox/networks/net_abc/connect",
      { sandboxId: "sbx_123" },
    );
    expect(result.connected).toBe(true);
  });

  it("disconnect calls POST /sandbox/networks/:id/disconnect", async () => {
    (mockClient.post as any).mockResolvedValue({ disconnected: true });

    const result = await manager.disconnect("net_abc", "sbx_123");

    expect(mockClient.post).toHaveBeenCalledWith(
      "/sandbox/networks/net_abc/disconnect",
      { sandboxId: "sbx_123" },
    );
    expect(result.disconnected).toBe(true);
  });

  it("delete calls DELETE /sandbox/networks/:id", async () => {
    (mockClient.del as any).mockResolvedValue({ deleted: "net_abc" });

    const result = await manager.delete("net_abc");

    expect(mockClient.del).toHaveBeenCalledWith("/sandbox/networks/net_abc");
    expect(result.deleted).toBe("net_abc");
  });

  it("propagates errors from client", async () => {
    (mockClient.post as any).mockRejectedValue(
      new Error("POST failed: 500"),
    );

    await expect(manager.create("fail-net")).rejects.toThrow("POST failed: 500");
  });
});
