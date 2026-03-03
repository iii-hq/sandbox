import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCommit = vi.fn().mockResolvedValue({ Id: "sha256:cloned-image-id" });

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  createContainer: vi.fn().mockResolvedValue({}),
  getDocker: () => ({
    getContainer: () => ({
      commit: mockCommit,
    }),
  }),
}));

import { registerCloneFunctions } from "../../packages/engine/src/functions/clone.js";
import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

vi.mock("../../packages/engine/src/docker/images.js", () => ({
  ensureImage: vi.fn().mockResolvedValue(undefined),
}));

describe("Clone Functions", () => {
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
    mockCommit.mockClear();

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

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: vi.fn(),
    };

    registerSandboxFunctions(sdk, kv as any, config);
    registerCloneFunctions(sdk, kv as any, config);
  });

  async function createSource(opts: Record<string, any> = {}) {
    const create = handlers.get("sandbox::create")!;
    return create({ image: "python:3.12-slim", ...opts });
  }

  it("clones an existing sandbox", async () => {
    const source = await createSource();
    const clone = handlers.get("sandbox::clone")!;
    const result = await clone({ id: source.id });

    expect(result.id).toBeTruthy();
    expect(result.id).not.toBe(source.id);
    expect(result.status).toBe("running");
    expect(result.image).toBe("sha256:cloned-image-id");
  });

  it("preserves config from source", async () => {
    const source = await createSource({
      memory: 1024,
      cpu: 2,
      network: true,
      metadata: { env: "prod" },
    });
    const clone = handlers.get("sandbox::clone")!;
    const result = await clone({ id: source.id });

    expect(result.config.memory).toBe(1024);
    expect(result.config.cpu).toBe(2);
    expect(result.config.network).toBe(true);
    expect(result.metadata).toEqual({ env: "prod" });
  });

  it("generates a new unique ID", async () => {
    const source = await createSource();
    const clone = handlers.get("sandbox::clone")!;
    const clone1 = await clone({ id: source.id });
    const clone2 = await clone({ id: source.id });

    expect(clone1.id).not.toBe(clone2.id);
    expect(clone1.id).not.toBe(source.id);
  });

  it("fails for non-existent sandbox", async () => {
    const clone = handlers.get("sandbox::clone")!;
    await expect(clone({ id: "sbx_missing" })).rejects.toThrow(
      "Sandbox not found",
    );
  });

  it("fails for stopped sandbox", async () => {
    const source = await createSource();
    const scope = kvStore.get("sandbox")!;
    const entry = scope.get(source.id);
    entry.status = "stopped";
    scope.set(source.id, entry);

    const clone = handlers.get("sandbox::clone")!;
    await expect(clone({ id: source.id })).rejects.toThrow(
      "Sandbox is stopped",
    );
  });

  it("uses custom name when provided", async () => {
    const source = await createSource();
    const clone = handlers.get("sandbox::clone")!;
    const result = await clone({ id: source.id, name: "my-clone" });

    expect(result.name).toBe("my-clone");
  });

  it("commits the source container", async () => {
    const source = await createSource();
    const clone = handlers.get("sandbox::clone")!;
    await clone({ id: source.id });

    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledWith(
      expect.objectContaining({ repo: expect.stringContaining("iii-sbx-clone-") }),
    );
  });

  it("creates a new KV entry for the clone", async () => {
    const source = await createSource();
    const clone = handlers.get("sandbox::clone")!;
    const result = await clone({ id: source.id });

    const get = handlers.get("sandbox::get")!;
    const fetched = await get({ id: result.id });
    expect(fetched.id).toBe(result.id);
    expect(fetched.status).toBe("running");
  });
});
