import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}))

import { registerObservabilityFunctions } from "../../packages/engine/src/functions/observability.js"

describe("Observability Functions", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, Map<string, any>>
  let kv: any

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = new Map()
    kvStore = new Map()

    kv = {
      get: vi.fn(async (scope: string, key: string) => kvStore.get(scope)?.get(key) ?? null),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!kvStore.has(scope)) kvStore.set(scope, new Map())
        kvStore.get(scope)!.set(key, value)
      }),
      delete: vi.fn(async (scope: string, key: string) => {
        kvStore.get(scope)?.delete(key)
      }),
      list: vi.fn(async (scope: string) => {
        const m = kvStore.get(scope)
        return m ? Array.from(m.values()) : []
      }),
    }

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
    }

    const config = {
      engineUrl: "ws://localhost:49134",
      workerName: "test",
      restPort: 3111,
      apiPrefix: "/sandbox",
      authToken: null,
      defaultImage: "python:3.12-slim",
      defaultTimeout: 3600,
      defaultMemory: 512,
      defaultCpu: 1,
      maxSandboxes: 50,
      ttlSweepInterval: "*/30 * * * * *",
      metricsInterval: "*/60 * * * * *",
      allowedImages: ["*"],
      workspaceDir: "/workspace",
      maxCommandTimeout: 300,
    }

    registerObservabilityFunctions(sdk, kv, config)
  })

  describe("observability::record-trace", () => {
    it("stores and returns a trace record", async () => {
      const handler = handlers.get("observability::record-trace")!
      const result = await handler({
        functionId: "sandbox::create",
        sandboxId: "sbx_abc",
        duration: 150,
        status: "ok",
      })

      expect(result.id).toMatch(/^trc_/)
      expect(result.functionId).toBe("sandbox::create")
      expect(result.sandboxId).toBe("sbx_abc")
      expect(result.duration).toBe(150)
      expect(result.status).toBe("ok")
      expect(result.timestamp).toBeGreaterThan(0)
      expect(kv.set).toHaveBeenCalledWith("observability", result.id, result)
    })

    it("stores error traces", async () => {
      const handler = handlers.get("observability::record-trace")!
      const result = await handler({
        functionId: "cmd::run",
        duration: 50,
        status: "error",
        error: "command failed",
      })

      expect(result.status).toBe("error")
      expect(result.error).toBe("command failed")
      expect(result.sandboxId).toBeUndefined()
    })
  })

  describe("observability::traces", () => {
    it("returns all traces when no filters", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      store.set("trc_1", { id: "trc_1", functionId: "sandbox::create", duration: 100, status: "ok", timestamp: 1000 })
      store.set("trc_2", { id: "trc_2", functionId: "cmd::run", sandboxId: "sbx_a", duration: 200, status: "ok", timestamp: 2000 })

      const handler = handlers.get("observability::traces")!
      const result = await handler({})

      expect(result.total).toBe(2)
      expect(result.traces).toHaveLength(2)
      expect(result.traces[0].timestamp).toBeGreaterThanOrEqual(result.traces[1].timestamp)
    })

    it("filters by sandboxId", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      store.set("trc_1", { id: "trc_1", functionId: "sandbox::create", duration: 100, status: "ok", timestamp: 1000 })
      store.set("trc_2", { id: "trc_2", functionId: "cmd::run", sandboxId: "sbx_a", duration: 200, status: "ok", timestamp: 2000 })

      const handler = handlers.get("observability::traces")!
      const result = await handler({ sandboxId: "sbx_a" })

      expect(result.total).toBe(1)
      expect(result.traces[0].id).toBe("trc_2")
    })

    it("filters by functionId", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      store.set("trc_1", { id: "trc_1", functionId: "sandbox::create", duration: 100, status: "ok", timestamp: 1000 })
      store.set("trc_2", { id: "trc_2", functionId: "cmd::run", duration: 200, status: "ok", timestamp: 2000 })

      const handler = handlers.get("observability::traces")!
      const result = await handler({ functionId: "cmd::run" })

      expect(result.total).toBe(1)
      expect(result.traces[0].functionId).toBe("cmd::run")
    })

    it("respects limit and offset", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      for (let i = 0; i < 5; i++) {
        store.set(`trc_${i}`, { id: `trc_${i}`, functionId: "cmd::run", duration: 10, status: "ok", timestamp: i * 1000 })
      }

      const handler = handlers.get("observability::traces")!
      const result = await handler({ limit: 2, offset: 1 })

      expect(result.total).toBe(5)
      expect(result.traces).toHaveLength(2)
    })

    it("returns empty when no traces", async () => {
      const handler = handlers.get("observability::traces")!
      const result = await handler({})

      expect(result.total).toBe(0)
      expect(result.traces).toHaveLength(0)
    })
  })

  describe("observability::metrics", () => {
    it("aggregates metrics from traces", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      store.set("trc_1", { id: "trc_1", functionId: "sandbox::create", duration: 100, status: "ok", timestamp: 1000 })
      store.set("trc_2", { id: "trc_2", functionId: "cmd::run", duration: 200, status: "ok", timestamp: 2000 })
      store.set("trc_3", { id: "trc_3", functionId: "cmd::run", duration: 50, status: "error", timestamp: 3000 })

      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map())
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1" })

      const handler = handlers.get("observability::metrics")!
      const result = await handler()

      expect(result.totalRequests).toBe(3)
      expect(result.totalErrors).toBe(1)
      expect(result.avgDuration).toBeCloseTo(116.67, 0)
      expect(result.p95Duration).toBeGreaterThan(0)
      expect(result.activeSandboxes).toBe(1)
      expect(result.functionCounts["sandbox::create"]).toBe(1)
      expect(result.functionCounts["cmd::run"]).toBe(2)
    })

    it("returns zeros when no data", async () => {
      const handler = handlers.get("observability::metrics")!
      const result = await handler()

      expect(result.totalRequests).toBe(0)
      expect(result.totalErrors).toBe(0)
      expect(result.avgDuration).toBe(0)
      expect(result.p95Duration).toBe(0)
      expect(result.activeSandboxes).toBe(0)
      expect(result.functionCounts).toEqual({})
    })
  })

  describe("observability::clear", () => {
    it("clears traces before timestamp", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      store.set("trc_1", { id: "trc_1", functionId: "a", duration: 10, status: "ok", timestamp: 1000 })
      store.set("trc_2", { id: "trc_2", functionId: "b", duration: 10, status: "ok", timestamp: 5000 })

      const handler = handlers.get("observability::clear")!
      const result = await handler({ before: 3000 })

      expect(result.cleared).toBe(1)
      expect(kvStore.get("observability")!.has("trc_1")).toBe(false)
      expect(kvStore.get("observability")!.has("trc_2")).toBe(true)
    })

    it("clears all traces when no before given", async () => {
      if (!kvStore.has("observability")) kvStore.set("observability", new Map())
      const store = kvStore.get("observability")!
      store.set("trc_1", { id: "trc_1", functionId: "a", duration: 10, status: "ok", timestamp: 1000 })
      store.set("trc_2", { id: "trc_2", functionId: "b", duration: 10, status: "ok", timestamp: 2000 })

      const handler = handlers.get("observability::clear")!
      const result = await handler({})

      expect(result.cleared).toBe(2)
      expect(kvStore.get("observability")!.size).toBe(0)
    })
  })
})
