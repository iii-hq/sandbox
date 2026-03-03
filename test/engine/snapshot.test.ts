import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCommit = vi.fn();
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockRemove = vi.fn().mockResolvedValue(undefined);
const mockImageInspect = vi.fn().mockResolvedValue({ Size: 104857600 });
const mockImageRemove = vi.fn().mockResolvedValue(undefined);

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  createContainer: vi.fn().mockResolvedValue({}),
  getDocker: () => ({
    getContainer: () => ({
      commit: mockCommit,
      stop: mockStop,
      remove: mockRemove,
    }),
    getImage: () => ({
      inspect: mockImageInspect,
      remove: mockImageRemove,
    }),
  }),
}));

import { registerSnapshotFunctions } from "../../packages/engine/src/functions/snapshot.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";
import { SCOPES } from "../../packages/engine/src/state/schema.js";

describe("Snapshot Functions", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;
  let kv: any;

  const config: EngineConfig = {
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

    mockCommit.mockResolvedValue({ Id: "sha256:abc123" });

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

    registerSnapshotFunctions(sdk, kv as any, config);
  });

  describe("snapshot::create", () => {
    it("creates a snapshot from a running sandbox", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const create = handlers.get("snapshot::create")!;
      const result = await create({ id: sandbox.id, name: "my-snapshot" });

      expect(result.id).toBeTruthy();
      expect(result.sandboxId).toBe(sandbox.id);
      expect(result.name).toBe("my-snapshot");
      expect(result.imageId).toBe("sha256:abc123");
      expect(result.size).toBe(104857600);
      expect(result.createdAt).toBeGreaterThan(0);
    });

    it("creates a snapshot with default name", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const create = handlers.get("snapshot::create")!;
      const result = await create({ id: sandbox.id });

      expect(result.name).toBe(result.id);
    });

    it("creates a snapshot from a paused sandbox", async () => {
      const sandbox = makeSandbox({ status: "paused" });
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const create = handlers.get("snapshot::create")!;
      const result = await create({ id: sandbox.id });

      expect(result.sandboxId).toBe(sandbox.id);
    });

    it("throws for stopped sandbox", async () => {
      const sandbox = makeSandbox({ status: "stopped" });
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const create = handlers.get("snapshot::create")!;
      await expect(create({ id: sandbox.id })).rejects.toThrow("Sandbox is stopped");
    });

    it("throws for non-existent sandbox", async () => {
      const create = handlers.get("snapshot::create")!;
      await expect(create({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });

    it("stores snapshot in KV", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const create = handlers.get("snapshot::create")!;
      const result = await create({ id: sandbox.id });

      const stored = kvStore.get(SCOPES.SNAPSHOTS)?.get(result.id);
      expect(stored).toBeDefined();
      expect(stored.sandboxId).toBe(sandbox.id);
    });

    it("calls docker commit with correct params", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const create = handlers.get("snapshot::create")!;
      const result = await create({ id: sandbox.id, name: "checkpoint" });

      expect(mockCommit).toHaveBeenCalledWith({
        repo: `iii-sbx-snap-${result.id}`,
        comment: "checkpoint",
      });
    });
  });

  describe("snapshot::restore", () => {
    it("restores a sandbox from a snapshot", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const snapshot = {
        id: "snap_abc",
        sandboxId: sandbox.id,
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const restore = handlers.get("snapshot::restore")!;
      const result = await restore({ id: sandbox.id, snapshotId: snapshot.id });

      expect(result.status).toBe("running");
      expect(result.image).toBe("sha256:abc123");
    });

    it("stops and removes old container", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const snapshot = {
        id: "snap_abc",
        sandboxId: sandbox.id,
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const restore = handlers.get("snapshot::restore")!;
      await restore({ id: sandbox.id, snapshotId: snapshot.id });

      expect(mockStop).toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalledWith({ force: true });
    });

    it("throws for non-existent snapshot", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const restore = handlers.get("snapshot::restore")!;
      await expect(
        restore({ id: sandbox.id, snapshotId: "snap_missing" }),
      ).rejects.toThrow("Snapshot not found");
    });

    it("throws for non-existent sandbox", async () => {
      const snapshot = {
        id: "snap_abc",
        sandboxId: "sbx_test123",
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const restore = handlers.get("snapshot::restore")!;
      await expect(
        restore({ id: "sbx_missing", snapshotId: snapshot.id }),
      ).rejects.toThrow("Sandbox not found");
    });

    it("updates sandbox in KV with new image", async () => {
      const sandbox = makeSandbox();
      kvStore.set(SCOPES.SANDBOXES, new Map([[sandbox.id, sandbox]]));

      const snapshot = {
        id: "snap_abc",
        sandboxId: sandbox.id,
        name: "test-snap",
        imageId: "sha256:newimage",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const restore = handlers.get("snapshot::restore")!;
      await restore({ id: sandbox.id, snapshotId: snapshot.id });

      const updated = kvStore.get(SCOPES.SANDBOXES)?.get(sandbox.id);
      expect(updated.image).toBe("sha256:newimage");
      expect(updated.status).toBe("running");
    });
  });

  describe("snapshot::list", () => {
    it("returns empty list when no snapshots", async () => {
      const list = handlers.get("snapshot::list")!;
      const result = await list({ id: "sbx_test123" });

      expect(result.snapshots).toEqual([]);
    });

    it("returns snapshots for a specific sandbox", async () => {
      const snap1 = {
        id: "snap_1",
        sandboxId: "sbx_test123",
        name: "snap1",
        imageId: "sha256:1",
        size: 100,
        createdAt: Date.now(),
      };
      const snap2 = {
        id: "snap_2",
        sandboxId: "sbx_test123",
        name: "snap2",
        imageId: "sha256:2",
        size: 200,
        createdAt: Date.now(),
      };
      const snap3 = {
        id: "snap_3",
        sandboxId: "sbx_other",
        name: "snap3",
        imageId: "sha256:3",
        size: 300,
        createdAt: Date.now(),
      };

      kvStore.set(
        SCOPES.SNAPSHOTS,
        new Map([
          [snap1.id, snap1],
          [snap2.id, snap2],
          [snap3.id, snap3],
        ]),
      );

      const list = handlers.get("snapshot::list")!;
      const result = await list({ id: "sbx_test123" });

      expect(result.snapshots).toHaveLength(2);
      expect(result.snapshots.every((s: any) => s.sandboxId === "sbx_test123")).toBe(
        true,
      );
    });

    it("does not return snapshots from other sandboxes", async () => {
      const snap = {
        id: "snap_1",
        sandboxId: "sbx_other",
        name: "snap1",
        imageId: "sha256:1",
        size: 100,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snap.id, snap]]));

      const list = handlers.get("snapshot::list")!;
      const result = await list({ id: "sbx_test123" });

      expect(result.snapshots).toHaveLength(0);
    });
  });

  describe("snapshot::delete", () => {
    it("deletes a snapshot and removes image", async () => {
      const snapshot = {
        id: "snap_abc",
        sandboxId: "sbx_test123",
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const del = handlers.get("snapshot::delete")!;
      const result = await del({ snapshotId: snapshot.id });

      expect(result.deleted).toBe(snapshot.id);
      expect(mockImageRemove).toHaveBeenCalled();
      expect(kvStore.get(SCOPES.SNAPSHOTS)?.has(snapshot.id)).toBe(false);
    });

    it("throws for non-existent snapshot", async () => {
      const del = handlers.get("snapshot::delete")!;
      await expect(del({ snapshotId: "snap_missing" })).rejects.toThrow(
        "Snapshot not found",
      );
    });

    it("succeeds even if docker image already removed", async () => {
      mockImageRemove.mockRejectedValueOnce(new Error("No such image"));

      const snapshot = {
        id: "snap_abc",
        sandboxId: "sbx_test123",
        name: "test-snap",
        imageId: "sha256:gone",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const del = handlers.get("snapshot::delete")!;
      const result = await del({ snapshotId: snapshot.id });

      expect(result.deleted).toBe(snapshot.id);
    });

    it("removes snapshot from KV store", async () => {
      const snapshot = {
        id: "snap_abc",
        sandboxId: "sbx_test123",
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      };
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]));

      const del = handlers.get("snapshot::delete")!;
      await del({ snapshotId: snapshot.id });

      expect(kv.delete).toHaveBeenCalledWith(SCOPES.SNAPSHOTS, snapshot.id);
    });
  });
});
