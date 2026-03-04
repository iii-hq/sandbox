import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockRemove = vi.fn().mockResolvedValue(undefined);
const mockInspect = vi.fn().mockResolvedValue({ Id: "docker-net-abc123" });

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => ({
    createNetwork: vi.fn().mockResolvedValue({
      inspect: mockInspect,
    }),
    getNetwork: () => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      remove: mockRemove,
    }),
  }),
}));

import { registerNetworkFunctions } from "../../packages/engine/src/functions/network.js";

describe("Network Functions", () => {
  let sdk: any;
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;
  let kv: any;

  const config: any = {
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
    kvStore = new Map();
    handlers = new Map();
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockRemove.mockClear();

    kv = {
      get: vi.fn(
        async (scope: string, key: string) =>
          kvStore.get(scope)?.get(key) ?? null,
      ),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!kvStore.has(scope)) kvStore.set(scope, new Map());
        kvStore.get(scope)!.set(key, value);
      }),
      delete: vi.fn(async (scope: string, key: string) => {
        kvStore.get(scope)?.delete(key);
      }),
      list: vi.fn(async (scope: string) => {
        const m = kvStore.get(scope);
        return m ? Array.from(m.values()) : [];
      }),
    };

    sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: vi.fn(),
    };

    registerNetworkFunctions(sdk, kv as any, config);
  });

  describe("network::create", () => {
    it("creates a network with default bridge driver", async () => {
      const create = handlers.get("network::create")!;
      const result = await create({ name: "test-net" });

      expect(result.id).toMatch(/^net_/);
      expect(result.name).toBe("test-net");
      expect(result.dockerNetworkId).toBe("docker-net-abc123");
      expect(result.sandboxes).toEqual([]);
      expect(result.createdAt).toBeGreaterThan(0);
    });

    it("rejects missing name", async () => {
      const create = handlers.get("network::create")!;
      await expect(create({})).rejects.toThrow("requires name");
    });

    it("rejects duplicate network names", async () => {
      const create = handlers.get("network::create")!;
      await create({ name: "dup-net" });
      await expect(create({ name: "dup-net" })).rejects.toThrow("already exists");
    });
  });

  describe("network::list", () => {
    it("returns empty list when no networks exist", async () => {
      const list = handlers.get("network::list")!;
      const result = await list();
      expect(result.networks).toEqual([]);
    });

    it("returns all created networks", async () => {
      const create = handlers.get("network::create")!;
      await create({ name: "net-a" });
      await create({ name: "net-b" });

      const list = handlers.get("network::list")!;
      const result = await list();
      expect(result.networks).toHaveLength(2);
    });
  });

  describe("network::connect", () => {
    it("connects a sandbox to a network", async () => {
      const create = handlers.get("network::create")!;
      const net = await create({ name: "conn-net" });

      kvStore.set(
        "sandbox",
        new Map([
          ["sbx_test1", { id: "sbx_test1", status: "running" }],
        ]),
      );

      const connect = handlers.get("network::connect")!;
      const result = await connect({
        networkId: net.id,
        sandboxId: "sbx_test1",
      });

      expect(result.connected).toBe(true);
      expect(mockConnect).toHaveBeenCalledWith({
        Container: "iii-sbx-sbx_test1",
      });
    });

    it("throws for non-existent network", async () => {
      const connect = handlers.get("network::connect")!;
      await expect(
        connect({ networkId: "net_missing", sandboxId: "sbx_test1" }),
      ).rejects.toThrow("Network not found");
    });

    it("throws for non-existent sandbox", async () => {
      const create = handlers.get("network::create")!;
      const net = await create({ name: "conn-net2" });

      const connect = handlers.get("network::connect")!;
      await expect(
        connect({ networkId: net.id, sandboxId: "sbx_missing" }),
      ).rejects.toThrow("Sandbox not found");
    });

    it("throws for already connected sandbox", async () => {
      const create = handlers.get("network::create")!;
      const net = await create({ name: "conn-net3" });

      kvStore.set(
        "sandbox",
        new Map([
          ["sbx_dup", { id: "sbx_dup", status: "running" }],
        ]),
      );

      const connect = handlers.get("network::connect")!;
      await connect({ networkId: net.id, sandboxId: "sbx_dup" });
      await expect(
        connect({ networkId: net.id, sandboxId: "sbx_dup" }),
      ).rejects.toThrow("already connected");
    });
  });

  describe("network::disconnect", () => {
    it("disconnects a sandbox from a network", async () => {
      const create = handlers.get("network::create")!;
      const net = await create({ name: "disc-net" });

      kvStore.set(
        "sandbox",
        new Map([
          ["sbx_disc", { id: "sbx_disc", status: "running" }],
        ]),
      );

      const connect = handlers.get("network::connect")!;
      await connect({ networkId: net.id, sandboxId: "sbx_disc" });

      const disconnect = handlers.get("network::disconnect")!;
      const result = await disconnect({
        networkId: net.id,
        sandboxId: "sbx_disc",
      });

      expect(result.disconnected).toBe(true);
      expect(mockDisconnect).toHaveBeenCalledWith({
        Container: "iii-sbx-sbx_disc",
      });
    });

    it("throws for non-connected sandbox", async () => {
      const create = handlers.get("network::create")!;
      const net = await create({ name: "disc-net2" });

      const disconnect = handlers.get("network::disconnect")!;
      await expect(
        disconnect({ networkId: net.id, sandboxId: "sbx_none" }),
      ).rejects.toThrow("is not connected");
    });
  });

  describe("network::delete", () => {
    it("deletes a network and disconnects all sandboxes", async () => {
      const create = handlers.get("network::create")!;
      const net = await create({ name: "del-net" });

      kvStore.set(
        "sandbox",
        new Map([
          ["sbx_a", { id: "sbx_a", status: "running" }],
          ["sbx_b", { id: "sbx_b", status: "running" }],
        ]),
      );

      const connect = handlers.get("network::connect")!;
      await connect({ networkId: net.id, sandboxId: "sbx_a" });
      await connect({ networkId: net.id, sandboxId: "sbx_b" });

      const del = handlers.get("network::delete")!;
      const result = await del({ networkId: net.id });

      expect(result.deleted).toBe(net.id);
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });

    it("throws for non-existent network", async () => {
      const del = handlers.get("network::delete")!;
      await expect(del({ networkId: "net_missing" })).rejects.toThrow(
        "Network not found",
      );
    });
  });
});
