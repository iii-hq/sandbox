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

import { registerTemplateFunctions } from "../../packages/engine/src/functions/template.js";
import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Template Functions", () => {
  let sdk: any;
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

  beforeEach(async () => {
    kvStore = new Map();
    handlers = new Map();

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

    registerTemplateFunctions(sdk, kv as any, config);
    await new Promise((r) => setTimeout(r, 10));
  });

  describe("builtin templates", () => {
    it("loads 4 builtin templates on registration", async () => {
      const list = handlers.get("template::list")!;
      const result = await list();
      expect(result.templates).toHaveLength(4);
      expect(result.templates.every((t: any) => t.builtin)).toBe(true);
    });

    it("includes python-data-science template", async () => {
      const get = handlers.get("template::get")!;
      const tpl = await get({ name: "python-data-science" });
      expect(tpl.config.image).toBe("python:3.12-slim");
      expect(tpl.config.memory).toBe(1024);
    });

    it("includes node-web template", async () => {
      const get = handlers.get("template::get")!;
      const tpl = await get({ name: "node-web" });
      expect(tpl.config.image).toBe("node:20-slim");
      expect(tpl.config.network).toBe(true);
    });
  });

  describe("template::create", () => {
    it("creates a custom template", async () => {
      const create = handlers.get("template::create")!;
      const tpl = await create({
        name: "custom-py",
        description: "Custom Python",
        config: { image: "python:3.11", memory: 2048 },
      });

      expect(tpl.id).toMatch(/^tpl_/);
      expect(tpl.name).toBe("custom-py");
      expect(tpl.builtin).toBe(false);
      expect(tpl.createdAt).toBeGreaterThan(0);
    });

    it("rejects duplicate names", async () => {
      const create = handlers.get("template::create")!;
      await expect(
        create({
          name: "python-data-science",
          description: "dup",
          config: { image: "python:3.12" },
        }),
      ).rejects.toThrow("already exists");
    });

    it("rejects missing name", async () => {
      const create = handlers.get("template::create")!;
      await expect(
        create({ description: "no name", config: { image: "python:3.12" } }),
      ).rejects.toThrow("requires name");
    });

    it("rejects missing config", async () => {
      const create = handlers.get("template::create")!;
      await expect(
        create({ name: "no-config", description: "no config" }),
      ).rejects.toThrow("requires name and config");
    });
  });

  describe("template::get", () => {
    it("gets template by ID", async () => {
      const get = handlers.get("template::get")!;
      const tpl = await get({ id: "tpl_python-data-science" });
      expect(tpl.name).toBe("python-data-science");
    });

    it("gets template by name", async () => {
      const get = handlers.get("template::get")!;
      const tpl = await get({ name: "go-api" });
      expect(tpl.config.image).toBe("golang:1.22-alpine");
    });

    it("throws for non-existent template", async () => {
      const get = handlers.get("template::get")!;
      await expect(get({ id: "tpl_missing" })).rejects.toThrow("not found");
    });

    it("throws when no id or name provided", async () => {
      const get = handlers.get("template::get")!;
      await expect(get({})).rejects.toThrow("Provide id or name");
    });
  });

  describe("template::delete", () => {
    it("deletes a custom template", async () => {
      const create = handlers.get("template::create")!;
      const tpl = await create({
        name: "deleteme",
        description: "temp",
        config: { image: "alpine" },
      });

      const del = handlers.get("template::delete")!;
      const result = await del({ id: tpl.id });
      expect(result.deleted).toBe(tpl.id);

      const get = handlers.get("template::get")!;
      await expect(get({ id: tpl.id })).rejects.toThrow("not found");
    });

    it("cannot delete builtin templates", async () => {
      const del = handlers.get("template::delete")!;
      await expect(del({ id: "tpl_python-data-science" })).rejects.toThrow(
        "Cannot delete builtin",
      );
    });

    it("throws for non-existent template", async () => {
      const del = handlers.get("template::delete")!;
      await expect(del({ id: "tpl_missing" })).rejects.toThrow("not found");
    });
  });

  describe("template::list", () => {
    it("includes both builtin and custom templates", async () => {
      const create = handlers.get("template::create")!;
      await create({
        name: "custom1",
        description: "c1",
        config: { image: "alpine" },
      });

      const list = handlers.get("template::list")!;
      const result = await list();
      expect(result.templates).toHaveLength(5);
      expect(result.templates.filter((t: any) => t.builtin)).toHaveLength(4);
      expect(result.templates.filter((t: any) => !t.builtin)).toHaveLength(1);
    });
  });

  describe("template-based sandbox creation", () => {
    beforeEach(() => {
      registerSandboxFunctions(sdk, kv as any, config);
    });

    it("creates sandbox from template by name", async () => {
      const create = handlers.get("sandbox::create")!;
      const sbx = await create({ template: "node-web" });

      expect(sbx.image).toBe("node:20-slim");
      expect(sbx.config.network).toBe(true);
    });

    it("creates sandbox from template with overrides", async () => {
      const create = handlers.get("sandbox::create")!;
      const sbx = await create({ template: "python-data-science", memory: 4096 });

      expect(sbx.image).toBe("python:3.12-slim");
      expect(sbx.config.memory).toBe(4096);
    });

    it("throws for non-existent template", async () => {
      const create = handlers.get("sandbox::create")!;
      await expect(create({ template: "nonexistent" })).rejects.toThrow(
        "Template not found",
      );
    });
  });
});
