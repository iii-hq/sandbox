import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateVolume = vi.fn();
const mockVolumeRemove = vi.fn().mockResolvedValue(undefined);

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => ({
    createVolume: mockCreateVolume,
    getVolume: () => ({
      remove: mockVolumeRemove,
    }),
  }),
}));

import { registerVolumeFunctions } from "../../packages/engine/src/functions/volume.js";
import { SCOPES } from "../../packages/engine/src/state/schema.js";

describe("Volume Functions", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;
  let kv: any;

  const config = {
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

  const makeSandbox = (overrides: Record<string, any> = {}) => ({
    id: "sbx_test123",
    name: "test",
    image: "python:3.12-slim",
    status: "running" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: { image: "python:3.12-slim", memory: 512, cpu: 1 },
    metadata: {},
    ...overrides,
  });

  beforeEach(() => {
    kvStore = new Map();
    handlers = new Map();
    vi.clearAllMocks();

    mockCreateVolume.mockResolvedValue({});

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

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: vi.fn(),
    };

    registerVolumeFunctions(sdk, kv as any, config as any);
  });

  describe("volume::create", () => {
    it("creates a volume with default driver", async () => {
      const create = handlers.get("volume::create")!;
      const result = await create({ name: "my-data" });

      expect(result.id).toBeTruthy();
      expect(result.name).toBe("my-data");
      expect(result.dockerVolumeName).toMatch(/^iii-vol-vol_/);
      expect(result.createdAt).toBeGreaterThan(0);
      expect(mockCreateVolume).toHaveBeenCalledWith({
        Name: result.dockerVolumeName,
        Driver: "local",
      });
    });

    it("creates a volume with custom driver", async () => {
      const create = handlers.get("volume::create")!;
      const result = await create({ name: "nfs-data", driver: "nfs" });

      expect(mockCreateVolume).toHaveBeenCalledWith({
        Name: result.dockerVolumeName,
        Driver: "nfs",
      });
    });

    it("stores volume in KV", async () => {
      const create = handlers.get("volume::create")!;
      const result = await create({ name: "persist" });

      const stored = kvStore.get(SCOPES.VOLUMES)?.get(result.id);
      expect(stored).toBeDefined();
      expect(stored.name).toBe("persist");
    });
  });

  describe("volume::list", () => {
    it("returns empty list when no volumes", async () => {
      const list = handlers.get("volume::list")!;
      const result = await list({});

      expect(result.volumes).toEqual([]);
    });

    it("returns all volumes", async () => {
      const vol1 = {
        id: "vol_1",
        name: "data",
        dockerVolumeName: "iii-vol-vol_1",
        createdAt: Date.now(),
      };
      const vol2 = {
        id: "vol_2",
        name: "logs",
        dockerVolumeName: "iii-vol-vol_2",
        createdAt: Date.now(),
      };

      kvStore.set(
        SCOPES.VOLUMES,
        new Map([
          [vol1.id, vol1],
          [vol2.id, vol2],
        ]),
      );

      const list = handlers.get("volume::list")!;
      const result = await list({});

      expect(result.volumes).toHaveLength(2);
    });
  });

  describe("volume::delete", () => {
    it("deletes a volume and removes docker volume", async () => {
      const volume = {
        id: "vol_abc",
        name: "test",
        dockerVolumeName: "iii-vol-vol_abc",
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.VOLUMES, new Map([[volume.id, volume]]));

      const del = handlers.get("volume::delete")!;
      const result = await del({ volumeId: volume.id });

      expect(result.deleted).toBe(volume.id);
      expect(mockVolumeRemove).toHaveBeenCalled();
      expect(kvStore.get(SCOPES.VOLUMES)?.has(volume.id)).toBe(false);
    });

    it("throws for non-existent volume", async () => {
      const del = handlers.get("volume::delete")!;
      await expect(del({ volumeId: "vol_missing" })).rejects.toThrow(
        "Volume not found",
      );
    });

    it("succeeds even if docker volume already removed", async () => {
      mockVolumeRemove.mockRejectedValueOnce(new Error("No such volume"));

      const volume = {
        id: "vol_abc",
        name: "test",
        dockerVolumeName: "iii-vol-vol_abc",
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.VOLUMES, new Map([[volume.id, volume]]));

      const del = handlers.get("volume::delete")!;
      const result = await del({ volumeId: volume.id });

      expect(result.deleted).toBe(volume.id);
    });
  });

  describe("volume::attach", () => {
    it("attaches a volume to a sandbox", async () => {
      const volume = {
        id: "vol_abc",
        name: "data",
        dockerVolumeName: "iii-vol-vol_abc",
        createdAt: Date.now(),
      };
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.VOLUMES, new Map([[volume.id, volume]]));
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const attach = handlers.get("volume::attach")!;
      const result = await attach({
        volumeId: volume.id,
        sandboxId: sandbox.id,
        mountPath: "/data",
      });

      expect(result.attached).toBe(true);
      expect(result.mountPath).toBe("/data");

      const updated = kvStore.get(SCOPES.VOLUMES)?.get(volume.id);
      expect(updated.sandboxId).toBe(sandbox.id);
      expect(updated.mountPath).toBe("/data");
    });

    it("throws for non-existent volume", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const attach = handlers.get("volume::attach")!;
      await expect(
        attach({
          volumeId: "vol_missing",
          sandboxId: sandbox.id,
          mountPath: "/data",
        }),
      ).rejects.toThrow("Volume not found");
    });

    it("throws for non-existent sandbox", async () => {
      const volume = {
        id: "vol_abc",
        name: "data",
        dockerVolumeName: "iii-vol-vol_abc",
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.VOLUMES, new Map([[volume.id, volume]]));

      const attach = handlers.get("volume::attach")!;
      await expect(
        attach({
          volumeId: volume.id,
          sandboxId: "sbx_missing",
          mountPath: "/data",
        }),
      ).rejects.toThrow("Sandbox not found");
    });
  });

  describe("volume::detach", () => {
    it("detaches a volume from a sandbox", async () => {
      const volume = {
        id: "vol_abc",
        name: "data",
        dockerVolumeName: "iii-vol-vol_abc",
        sandboxId: "sbx_test123",
        mountPath: "/data",
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.VOLUMES, new Map([[volume.id, volume]]));

      const detach = handlers.get("volume::detach")!;
      const result = await detach({ volumeId: volume.id });

      expect(result.detached).toBe(true);

      const updated = kvStore.get(SCOPES.VOLUMES)?.get(volume.id);
      expect(updated.sandboxId).toBeUndefined();
      expect(updated.mountPath).toBeUndefined();
    });

    it("throws for non-existent volume", async () => {
      const detach = handlers.get("volume::detach")!;
      await expect(detach({ volumeId: "vol_missing" })).rejects.toThrow(
        "Volume not found",
      );
    });
  });
});
