import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}))

const mockGetContainerStats = vi.fn()
const mockGetDocker = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
  getDocker: () => mockGetDocker(),
}))

import {
  registerMetricsFunctions,
  incrementCreated,
  incrementKilled,
  incrementExpired,
} from "../../packages/engine/src/functions/metrics.js"

describe("Metrics Functions", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, Map<string, any>>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = new Map()
    kvStore = new Map()

    const kv = {
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

    registerMetricsFunctions(sdk, kv as any)
  })

  describe("metrics::sandbox", () => {
    it("returns stats for existing sandbox", async () => {
      const sandbox = {
        id: "sbx_test",
        name: "test",
        image: "python:3.12-slim",
        status: "running",
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        config: {},
        metadata: {},
      }

      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map())
      kvStore.get("sandbox")!.set("sbx_test", sandbox)

      const mockContainerRef = { id: "container-1" }
      mockGetDocker.mockReturnValue({
        getContainer: (name: string) => {
          expect(name).toBe("iii-sbx-sbx_test")
          return mockContainerRef
        },
      })

      mockGetContainerStats.mockResolvedValue({
        sandboxId: "sbx_test",
        cpuPercent: 25.5,
        memoryUsageMb: 128,
        memoryLimitMb: 512,
        networkRxBytes: 1024,
        networkTxBytes: 2048,
        pids: 3,
      })

      const metricsHandler = handlers.get("metrics::sandbox")!
      const result = await metricsHandler({ id: "sbx_test" })

      expect(result.sandboxId).toBe("sbx_test")
      expect(result.cpuPercent).toBe(25.5)
      expect(result.memoryUsageMb).toBe(128)
      expect(mockGetContainerStats).toHaveBeenCalledWith(mockContainerRef)
    })

    it("throws for missing sandbox", async () => {
      const metricsHandler = handlers.get("metrics::sandbox")!
      await expect(metricsHandler({ id: "sbx_missing" })).rejects.toThrow("Sandbox not found")
    })
  })

  describe("metrics::global", () => {
    it("returns correct counts after increments", async () => {
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map())
      kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1" })
      kvStore.get("sandbox")!.set("sbx_2", { id: "sbx_2" })

      incrementCreated()
      incrementCreated()
      incrementCreated()
      incrementKilled()
      incrementExpired()

      const globalHandler = handlers.get("metrics::global")!
      const result = await globalHandler()

      expect(result.activeSandboxes).toBe(2)
      expect(result.totalCreated).toBeGreaterThanOrEqual(3)
      expect(result.totalKilled).toBeGreaterThanOrEqual(1)
      expect(result.totalExpired).toBeGreaterThanOrEqual(1)
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0)
    })

    it("returns zero active sandboxes when none exist", async () => {
      const globalHandler = handlers.get("metrics::global")!
      const result = await globalHandler()

      expect(result.activeSandboxes).toBe(0)
    })
  })

  describe("incrementCreated/Killed/Expired", () => {
    it("counters reflect in global metrics", async () => {
      const globalHandler = handlers.get("metrics::global")!

      const before = await globalHandler()
      const prevCreated = before.totalCreated
      const prevKilled = before.totalKilled
      const prevExpired = before.totalExpired

      incrementCreated()
      incrementKilled()
      incrementExpired()

      const after = await globalHandler()

      expect(after.totalCreated).toBe(prevCreated + 1)
      expect(after.totalKilled).toBe(prevKilled + 1)
      expect(after.totalExpired).toBe(prevExpired + 1)
    })
  })
})
