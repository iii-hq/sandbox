import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockInfo, mockWarn } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
}))

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: mockInfo, warn: mockWarn } }),
}))

import { registerEventTriggers } from "../../packages/engine/src/triggers/events.js"

describe("Event Triggers", () => {
  let sdk: any
  let handlers: Map<string, Function>
  let triggers: any[]

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = new Map()
    triggers = []

    sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
      registerTrigger: vi.fn((trigger: any) => {
        triggers.push(trigger)
      }),
    }

    registerEventTriggers(sdk)
  })

  it("registers 3 functions", () => {
    expect(sdk.registerFunction).toHaveBeenCalledTimes(3)
    expect(handlers.has("event::sandbox-created")).toBe(true)
    expect(handlers.has("event::sandbox-killed")).toBe(true)
    expect(handlers.has("event::sandbox-expired")).toBe(true)
  })

  it("registers 3 triggers", () => {
    expect(sdk.registerTrigger).toHaveBeenCalledTimes(3)
    expect(triggers).toHaveLength(3)
  })

  it("each trigger has type queue with correct topic", () => {
    const topicMap: Record<string, string> = {
      "event::sandbox-created": "sandbox.created",
      "event::sandbox-killed": "sandbox.killed",
      "event::sandbox-expired": "sandbox.expired",
    }

    for (const trigger of triggers) {
      expect(trigger.type).toBe("queue")
      expect(topicMap[trigger.function_id]).toBe(trigger.config.topic)
    }
  })

  it("sandbox-created trigger has correct topic", () => {
    const trigger = triggers.find((t) => t.function_id === "event::sandbox-created")
    expect(trigger).toBeDefined()
    expect(trigger.config.topic).toBe("sandbox.created")
  })

  it("sandbox-killed trigger has correct topic", () => {
    const trigger = triggers.find((t) => t.function_id === "event::sandbox-killed")
    expect(trigger).toBeDefined()
    expect(trigger.config.topic).toBe("sandbox.killed")
  })

  it("sandbox-expired trigger has correct topic", () => {
    const trigger = triggers.find((t) => t.function_id === "event::sandbox-expired")
    expect(trigger).toBeDefined()
    expect(trigger.config.topic).toBe("sandbox.expired")
  })

  it("event handlers log the event data", async () => {
    const createdHandler = handlers.get("event::sandbox-created")!
    await createdHandler({ id: "sbx_1", image: "python:3.12-slim" })

    expect(mockInfo).toHaveBeenCalledWith(
      "sandbox.created event",
      { id: "sbx_1", image: "python:3.12-slim" },
    )
  })

  it("killed handler logs with correct topic", async () => {
    const killedHandler = handlers.get("event::sandbox-killed")!
    await killedHandler({ id: "sbx_2", reason: "user" })

    expect(mockInfo).toHaveBeenCalledWith(
      "sandbox.killed event",
      { id: "sbx_2", reason: "user" },
    )
  })

  it("expired handler logs with correct topic", async () => {
    const expiredHandler = handlers.get("event::sandbox-expired")!
    await expiredHandler({ id: "sbx_3", ttl: 3600 })

    expect(mockInfo).toHaveBeenCalledWith(
      "sandbox.expired event",
      { id: "sbx_3", ttl: 3600 },
    )
  })
})
