import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}))

import { registerEventFunctions } from "../../packages/engine/src/functions/event.js"
import { registerEventTriggers } from "../../packages/engine/src/triggers/events.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

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
  defaultImage: "python:3.12-slim",
  ttlSweepInterval: "*/30 * * * * *",
  metricsInterval: "*/60 * * * * *",
}

describe("Event Functions", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, any>
  let kv: any
  let sdk: any
  let triggers: any[]

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = new Map()
    kvStore = new Map()
    triggers = []

    kv = {
      get: vi.fn(async (_scope: string, key: string) => kvStore.get(key) ?? null),
      set: vi.fn(async (_scope: string, key: string, value: any) => {
        kvStore.set(key, value)
      }),
      delete: vi.fn(),
      list: vi.fn(async () => [...kvStore.values()]),
    }

    sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
      registerTrigger: vi.fn((trigger: any) => {
        triggers.push(trigger)
      }),
      trigger: vi.fn(),
    }

    registerEventFunctions(sdk, kv, config)
  })

  describe("event::publish", () => {
    it("creates and stores an event", async () => {
      const fn = handlers.get("event::publish")!
      const result = await fn({
        topic: "sandbox.created",
        sandboxId: "sbx_test",
        data: { image: "python:3.12" },
      })

      expect(result.id).toMatch(/^evt_/)
      expect(result.topic).toBe("sandbox.created")
      expect(result.sandboxId).toBe("sbx_test")
      expect(result.data).toEqual({ image: "python:3.12" })
      expect(result.timestamp).toBeTypeOf("number")
    })

    it("stores event in KV", async () => {
      const fn = handlers.get("event::publish")!
      const result = await fn({
        topic: "sandbox.created",
        sandboxId: "sbx_test",
      })

      expect(kv.set).toHaveBeenCalledWith("event", result.id, result)
    })

    it("triggers queue publish", async () => {
      const fn = handlers.get("event::publish")!
      const result = await fn({
        topic: "sandbox.killed",
        sandboxId: "sbx_test",
      })

      expect(sdk.trigger).toHaveBeenCalledWith("queue::publish", {
        topic: "sandbox.killed",
        payload: result,
      })
    })

    it("defaults data to empty object", async () => {
      const fn = handlers.get("event::publish")!
      const result = await fn({
        topic: "sandbox.created",
        sandboxId: "sbx_test",
      })

      expect(result.data).toEqual({})
    })

    it("throws when topic is missing", async () => {
      const fn = handlers.get("event::publish")!
      await expect(fn({ sandboxId: "sbx_test" })).rejects.toThrow("topic is required")
    })

    it("throws when sandboxId is missing", async () => {
      const fn = handlers.get("event::publish")!
      await expect(fn({ topic: "sandbox.created" })).rejects.toThrow("sandboxId is required")
    })
  })

  describe("event::history", () => {
    beforeEach(() => {
      const events = [
        { id: "evt_1", topic: "sandbox.created", sandboxId: "sbx_a", data: {}, timestamp: 1000 },
        { id: "evt_2", topic: "sandbox.killed", sandboxId: "sbx_a", data: {}, timestamp: 2000 },
        { id: "evt_3", topic: "sandbox.created", sandboxId: "sbx_b", data: {}, timestamp: 3000 },
      ]
      for (const e of events) kvStore.set(e.id, e)
    })

    it("returns all events sorted by timestamp desc", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({})

      expect(result.events).toHaveLength(3)
      expect(result.total).toBe(3)
      expect(result.events[0].id).toBe("evt_3")
      expect(result.events[2].id).toBe("evt_1")
    })

    it("filters by sandboxId", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({ sandboxId: "sbx_a" })

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.events.every((e: any) => e.sandboxId === "sbx_a")).toBe(true)
    })

    it("filters by topic", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({ topic: "sandbox.created" })

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it("filters by both sandboxId and topic", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({ sandboxId: "sbx_a", topic: "sandbox.created" })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe("evt_1")
    })

    it("applies limit", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({ limit: 2 })

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(3)
    })

    it("applies offset", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({ offset: 1, limit: 1 })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe("evt_2")
    })

    it("returns empty for no matches", async () => {
      const fn = handlers.get("event::history")!
      const result = await fn({ sandboxId: "sbx_none" })

      expect(result.events).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })

  describe("event::subscribe", () => {
    it("returns subscribed topic", async () => {
      const fn = handlers.get("event::subscribe")!
      const result = await fn({ topic: "sandbox.custom" })

      expect(result).toEqual({ subscribed: "sandbox.custom" })
    })

    it("registers a handler function", async () => {
      const fn = handlers.get("event::subscribe")!
      await fn({ topic: "sandbox.custom" })

      expect(handlers.has("event::on-sandbox-custom")).toBe(true)
    })

    it("registers a queue trigger", async () => {
      const fn = handlers.get("event::subscribe")!
      await fn({ topic: "sandbox.custom" })

      const trigger = triggers.find(
        (t) => t.function_id === "event::on-sandbox-custom",
      )
      expect(trigger).toBeDefined()
      expect(trigger.type).toBe("queue")
      expect(trigger.config.topic).toBe("sandbox.custom")
    })

    it("throws when topic is missing", async () => {
      const fn = handlers.get("event::subscribe")!
      await expect(fn({})).rejects.toThrow("topic is required")
    })
  })
})

describe("Event Triggers (extended)", () => {
  let handlers: Map<string, Function>
  let triggers: any[]
  let kvStore: Map<string, any>
  let kv: any
  let sdk: any

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = new Map()
    triggers = []
    kvStore = new Map()

    kv = {
      get: vi.fn(async (_scope: string, key: string) => kvStore.get(key) ?? null),
      set: vi.fn(async (_scope: string, key: string, value: any) => {
        kvStore.set(key, value)
      }),
      delete: vi.fn(),
      list: vi.fn(async () => [...kvStore.values()]),
    }

    sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
      registerTrigger: vi.fn((trigger: any) => {
        triggers.push(trigger)
      }),
    }

    registerEventTriggers(sdk, kv)
  })

  it("registers 8 functions", () => {
    expect(sdk.registerFunction).toHaveBeenCalledTimes(8)
  })

  it("registers 8 triggers", () => {
    expect(sdk.registerTrigger).toHaveBeenCalledTimes(8)
    expect(triggers).toHaveLength(8)
  })

  it("includes new topics: paused, resumed, snapshot, exec, error", () => {
    const topics = triggers.map((t) => t.config.topic)
    expect(topics).toContain("sandbox.paused")
    expect(topics).toContain("sandbox.resumed")
    expect(topics).toContain("sandbox.snapshot")
    expect(topics).toContain("sandbox.exec")
    expect(topics).toContain("sandbox.error")
  })

  it("stores events in KV when kv is provided", async () => {
    const handler = handlers.get("event::sandbox-paused")!
    await handler({ sandboxId: "sbx_1", reason: "user" })

    expect(kv.set).toHaveBeenCalledWith(
      "event",
      expect.stringMatching(/^evt_/),
      expect.objectContaining({
        topic: "sandbox.paused",
        sandboxId: "sbx_1",
      }),
    )
  })

  it("event handler extracts sandboxId from data.id as fallback", async () => {
    const handler = handlers.get("event::sandbox-error")!
    await handler({ id: "sbx_fallback", error: "something" })

    expect(kv.set).toHaveBeenCalledWith(
      "event",
      expect.any(String),
      expect.objectContaining({
        sandboxId: "sbx_fallback",
      }),
    )
  })
})
