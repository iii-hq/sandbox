import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), warn: vi.fn() },
  }),
}))

const mockContainer = {
  stop: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}

const mockGetDocker = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => mockGetDocker(),
}))

const mockIncrementExpired = vi.fn()

vi.mock("../../packages/engine/src/functions/metrics.js", () => ({
  incrementExpired: () => mockIncrementExpired(),
}))

import { registerTtlSweep } from "../../packages/engine/src/lifecycle/ttl.js"

describe("TTL Sweep", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, Map<string, any>>
  let kvMock: any

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = new Map()
    kvStore = new Map()
    kvStore.set("sandbox", new Map())

    kvMock = {
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

    mockGetDocker.mockReturnValue({
      getContainer: () => mockContainer,
    })

    registerTtlSweep(sdk, kvMock as any)
  })

  describe("lifecycle::ttl-sweep", () => {
    it("sweeps expired sandboxes and leaves active ones", async () => {
      const now = Date.now()
      kvStore.get("sandbox")!.set("sbx_expired1", {
        id: "sbx_expired1",
        expiresAt: now - 10000,
        status: "running",
      })
      kvStore.get("sandbox")!.set("sbx_expired2", {
        id: "sbx_expired2",
        expiresAt: now - 5000,
        status: "running",
      })
      kvStore.get("sandbox")!.set("sbx_active", {
        id: "sbx_active",
        expiresAt: now + 60000,
        status: "running",
      })

      const sweep = handlers.get("lifecycle::ttl-sweep")!
      const result = await sweep()

      expect(result.swept).toBe(2)
      expect(kvStore.get("sandbox")!.has("sbx_expired1")).toBe(false)
      expect(kvStore.get("sandbox")!.has("sbx_expired2")).toBe(false)
      expect(kvStore.get("sandbox")!.has("sbx_active")).toBe(true)
    })

    it("stops and removes containers for expired sandboxes", async () => {
      const now = Date.now()
      kvStore.get("sandbox")!.set("sbx_exp", {
        id: "sbx_exp",
        expiresAt: now - 1000,
        status: "running",
      })

      const sweep = handlers.get("lifecycle::ttl-sweep")!
      await sweep()

      expect(mockContainer.stop).toHaveBeenCalled()
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
    })

    it("calls incrementExpired for each swept sandbox", async () => {
      const now = Date.now()
      kvStore.get("sandbox")!.set("sbx_e1", {
        id: "sbx_e1",
        expiresAt: now - 1000,
        status: "running",
      })
      kvStore.get("sandbox")!.set("sbx_e2", {
        id: "sbx_e2",
        expiresAt: now - 2000,
        status: "running",
      })

      const sweep = handlers.get("lifecycle::ttl-sweep")!
      await sweep()

      expect(mockIncrementExpired).toHaveBeenCalledTimes(2)
    })

    it("returns swept count of 0 when no sandboxes expired", async () => {
      const now = Date.now()
      kvStore.get("sandbox")!.set("sbx_ok", {
        id: "sbx_ok",
        expiresAt: now + 999999,
        status: "running",
      })

      const sweep = handlers.get("lifecycle::ttl-sweep")!
      const result = await sweep()

      expect(result.swept).toBe(0)
      expect(mockContainer.stop).not.toHaveBeenCalled()
    })

    it("continues on container stop/remove errors", async () => {
      const now = Date.now()
      mockContainer.stop.mockRejectedValueOnce(new Error("already stopped"))
      kvStore.get("sandbox")!.set("sbx_err", {
        id: "sbx_err",
        expiresAt: now - 1000,
        status: "running",
      })

      const sweep = handlers.get("lifecycle::ttl-sweep")!
      const result = await sweep()

      expect(result.swept).toBe(1)
    })

    it("handles empty sandbox list", async () => {
      const sweep = handlers.get("lifecycle::ttl-sweep")!
      const result = await sweep()

      expect(result.swept).toBe(0)
    })
  })

  describe("lifecycle::health", () => {
    it("returns healthy status with uptime", async () => {
      const health = handlers.get("lifecycle::health")!
      const result = await health()

      expect(result.status).toBe("healthy")
      expect(typeof result.uptime).toBe("number")
      expect(result.uptime).toBeGreaterThanOrEqual(0)
    })
  })
})
