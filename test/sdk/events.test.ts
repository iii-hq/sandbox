import { describe, it, expect, vi, afterEach } from "vitest"

describe("EventManager", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("history calls GET with no params", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0 }),
    })

    const { EventManager, HttpClient } = await import("../../packages/sdk/src/index.js")
    const client = new HttpClient({ baseUrl: "http://localhost:3111" })
    const mgr = new EventManager(client)
    const result = await mgr.history()

    expect(result).toEqual({ events: [], total: 0 })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3111/sandbox/events/history",
      expect.anything(),
    )
  })

  it("history passes sandboxId and topic as query params", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [{ id: "evt_1" }], total: 1 }),
    })

    const { EventManager, HttpClient } = await import("../../packages/sdk/src/index.js")
    const client = new HttpClient({ baseUrl: "http://localhost:3111" })
    const mgr = new EventManager(client)
    await mgr.history({ sandboxId: "sbx_1", topic: "sandbox.created", limit: 10 })

    const url = (globalThis.fetch as any).mock.calls[0][0] as string
    expect(url).toContain("sandboxId=sbx_1")
    expect(url).toContain("topic=sandbox.created")
    expect(url).toContain("limit=10")
  })

  it("publish calls POST with correct body", async () => {
    const event = {
      id: "evt_new",
      topic: "custom.test",
      sandboxId: "sbx_1",
      data: { key: "value" },
      timestamp: Date.now(),
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(event),
    })

    const { EventManager, HttpClient } = await import("../../packages/sdk/src/index.js")
    const client = new HttpClient({ baseUrl: "http://localhost:3111" })
    const mgr = new EventManager(client)
    const result = await mgr.publish("custom.test", "sbx_1", { key: "value" })

    expect(result).toEqual(event)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3111/sandbox/events/publish",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          topic: "custom.test",
          sandboxId: "sbx_1",
          data: { key: "value" },
        }),
      }),
    )
  })

  it("publish works without data", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "evt_2",
          topic: "sandbox.ping",
          sandboxId: "sbx_1",
          data: {},
          timestamp: Date.now(),
        }),
    })

    const { EventManager, HttpClient } = await import("../../packages/sdk/src/index.js")
    const client = new HttpClient({ baseUrl: "http://localhost:3111" })
    const mgr = new EventManager(client)
    const result = await mgr.publish("sandbox.ping", "sbx_1")

    expect(result.topic).toBe("sandbox.ping")
  })

  it("history with offset param", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 5 }),
    })

    const { EventManager, HttpClient } = await import("../../packages/sdk/src/index.js")
    const client = new HttpClient({ baseUrl: "http://localhost:3111" })
    const mgr = new EventManager(client)
    await mgr.history({ offset: 10 })

    const url = (globalThis.fetch as any).mock.calls[0][0] as string
    expect(url).toContain("offset=10")
  })

  it("EventManager is exported from SDK", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(sdk.EventManager).toBeDefined()
  })
})
