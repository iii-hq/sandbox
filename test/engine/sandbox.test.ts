import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  createContainer: vi.fn().mockResolvedValue({}),
  getDocker: () => ({
    getContainer: () => ({
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      unpause: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

vi.mock("../../packages/engine/src/docker/images.js", () => ({
  ensureImage: vi.fn().mockResolvedValue(undefined),
}));

import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Sandbox Functions", () => {
  let sdk: any;
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;

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

  beforeEach(() => {
    kvStore = new Map();
    handlers = new Map();

    const kv = {
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

    registerSandboxFunctions(sdk, kv as any, config);
  });

  describe("sandbox::create", () => {
    it("creates a sandbox with defaults", async () => {
      const create = handlers.get("sandbox::create")!;
      const result = await create({ image: "python:3.12-slim" });

      expect(result.id).toBeTruthy();
      expect(result.image).toBe("python:3.12-slim");
      expect(result.status).toBe("running");
      expect(result.config.memory).toBe(512);
      expect(result.metadata).toEqual({});
    });

    it("creates sandbox with custom options", async () => {
      const create = handlers.get("sandbox::create")!;
      const result = await create({
        image: "python:3.12-slim",
        name: "test-sbx",
        memory: 1024,
        cpu: 2,
        network: true,
        metadata: { env: "test" },
      });

      expect(result.name).toBe("test-sbx");
      expect(result.config.memory).toBe(1024);
      expect(result.config.cpu).toBe(2);
      expect(result.config.network).toBe(true);
      expect(result.metadata).toEqual({ env: "test" });
    });

    it("creates sandbox with custom entrypoint", async () => {
      const create = handlers.get("sandbox::create")!;
      const result = await create({
        image: "python:3.12-slim",
        entrypoint: ["/bin/bash", "-c", "python server.py"],
      });

      expect(result.entrypoint).toEqual([
        "/bin/bash",
        "-c",
        "python server.py",
      ]);
    });

    it("enforces max sandbox limit", async () => {
      const create = handlers.get("sandbox::create")!;

      for (let i = 0; i < 10; i++) {
        await create({ image: "python:3.12-slim" });
      }

      await expect(create({ image: "python:3.12-slim" })).rejects.toThrow(
        "Maximum sandbox limit",
      );
    });

    it("rejects disallowed images", async () => {
      const restrictedConfig = { ...config, allowedImages: ["python:*"] };
      const restrictedHandlers = new Map<string, Function>();
      const restrictedSdk = {
        registerFunction: vi.fn((meta: any, handler: Function) => {
          restrictedHandlers.set(meta.id, handler);
        }),
        trigger: vi.fn(),
      };

      const kv = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      };

      registerSandboxFunctions(restrictedSdk, kv as any, restrictedConfig);
      const create = restrictedHandlers.get("sandbox::create")!;
      await expect(create({ image: "node:20" })).rejects.toThrow(
        "Image not allowed",
      );
    });

    it("sets expiration time based on timeout", async () => {
      const create = handlers.get("sandbox::create")!;
      const before = Date.now();
      const result = await create({ image: "python:3.12-slim", timeout: 60 });

      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 60000);
      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 61000);
    });
  });

  describe("sandbox::get", () => {
    it("returns existing sandbox", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim" });

      const get = handlers.get("sandbox::get")!;
      const result = await get({ id: created.id });
      expect(result.id).toBe(created.id);
    });

    it("throws for non-existent sandbox", async () => {
      const get = handlers.get("sandbox::get")!;
      await expect(get({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });

  describe("sandbox::list", () => {
    it("returns empty list initially", async () => {
      const list = handlers.get("sandbox::list")!;
      const result = await list({});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("lists created sandboxes", async () => {
      const create = handlers.get("sandbox::create")!;
      await create({ image: "python:3.12-slim" });
      await create({ image: "node:20" });

      const list = handlers.get("sandbox::list")!;
      const result = await list({});
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      const create = handlers.get("sandbox::create")!;
      await create({ image: "python:3.12-slim" });

      const list = handlers.get("sandbox::list")!;
      const running = await list({ status: "running" });
      expect(running.items).toHaveLength(1);

      const paused = await list({ status: "paused" });
      expect(paused.items).toHaveLength(0);
    });

    it("filters by metadata", async () => {
      const create = handlers.get("sandbox::create")!;
      await create({ image: "python:3.12-slim", metadata: { team: "alpha" } });
      await create({ image: "python:3.12-slim", metadata: { team: "beta" } });

      const list = handlers.get("sandbox::list")!;
      const result = await list({ metadata: { team: "alpha" } });
      expect(result.items).toHaveLength(1);
    });

    it("paginates results", async () => {
      const create = handlers.get("sandbox::create")!;
      for (let i = 0; i < 5; i++) {
        await create({ image: "python:3.12-slim" });
      }

      const list = handlers.get("sandbox::list")!;
      const page1 = await list({ page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);

      const page2 = await list({ page: 2, pageSize: 2 });
      expect(page2.items).toHaveLength(2);

      const page3 = await list({ page: 3, pageSize: 2 });
      expect(page3.items).toHaveLength(1);
    });

    it("clamps pageSize between 1 and 200", async () => {
      const list = handlers.get("sandbox::list")!;
      const result1 = await list({ pageSize: 0 });
      expect(result1.pageSize).toBe(1);

      const result2 = await list({ pageSize: 500 });
      expect(result2.pageSize).toBe(200);
    });
  });

  describe("sandbox::renew", () => {
    it("renews sandbox expiration", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim", timeout: 60 });

      const renew = handlers.get("sandbox::renew")!;
      const newExpiry = Date.now() + 7200000;
      const result = await renew({ id: created.id, expiresAt: newExpiry });

      expect(result.expiresAt).toBeGreaterThanOrEqual(created.expiresAt);
    });

    it("clamps to minimum 1 minute from now", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim" });

      const renew = handlers.get("sandbox::renew")!;
      const result = await renew({ id: created.id, expiresAt: 0 });

      expect(result.expiresAt).toBeGreaterThanOrEqual(Date.now() + 59000);
    });

    it("clamps to maximum 24 hours from now", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim" });

      const renew = handlers.get("sandbox::renew")!;
      const farFuture = Date.now() + 999999999999;
      const result = await renew({ id: created.id, expiresAt: farFuture });

      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 86401000);
    });

    it("throws for non-existent sandbox", async () => {
      const renew = handlers.get("sandbox::renew")!;
      await expect(
        renew({ id: "sbx_missing", expiresAt: Date.now() }),
      ).rejects.toThrow("Sandbox not found");
    });
  });

  describe("sandbox::kill", () => {
    it("removes sandbox from state", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim" });

      const kill = handlers.get("sandbox::kill")!;
      const result = await kill({ id: created.id });
      expect(result.success).toBe(true);

      const get = handlers.get("sandbox::get")!;
      await expect(get({ id: created.id })).rejects.toThrow("not found");
    });

    it("throws for non-existent sandbox", async () => {
      const kill = handlers.get("sandbox::kill")!;
      await expect(kill({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });

  describe("sandbox::pause", () => {
    it("pauses a running sandbox", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim" });

      const pause = handlers.get("sandbox::pause")!;
      const result = await pause({ id: created.id });
      expect(result.status).toBe("paused");
    });

    it("throws for non-existent sandbox", async () => {
      const pause = handlers.get("sandbox::pause")!;
      await expect(pause({ id: "sbx_missing" })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });

  describe("sandbox::resume", () => {
    it("resumes a paused sandbox", async () => {
      const create = handlers.get("sandbox::create")!;
      const created = await create({ image: "python:3.12-slim" });

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: created.id });

      const resume = handlers.get("sandbox::resume")!;
      const result = await resume({ id: created.id });
      expect(result.status).toBe("running");
    });
  });
});
