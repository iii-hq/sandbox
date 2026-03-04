import { describe, it, expect, vi, beforeEach } from "vitest"
import { StreamManager } from "../../packages/sdk/src/stream-manager.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("StreamManager", () => {
  let mockClient: HttpClient
  const sandboxId = "sbx_test123"

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
      streamGet: vi.fn(),
    } as unknown as HttpClient
  })

  describe("logs", () => {
    it("calls streamGet with correct path", async () => {
      const mockGen = (async function* () {
        yield JSON.stringify({ type: "stdout", data: "hello", timestamp: 1 })
        yield JSON.stringify({ type: "end", data: "", timestamp: 2 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      const events = []
      for await (const event of mgr.logs()) {
        events.push(event)
      }

      expect(mockClient.streamGet).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/stream/logs`,
      )
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe("stdout")
      expect(events[0].data).toBe("hello")
    })

    it("passes tail option as query param", async () => {
      const mockGen = (async function* () {
        yield JSON.stringify({ type: "end", data: "", timestamp: 1 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      for await (const _ of mgr.logs({ tail: 50 })) { break }

      expect(mockClient.streamGet).toHaveBeenCalledWith(
        expect.stringContaining("tail=50"),
      )
    })

    it("passes follow option as query param", async () => {
      const mockGen = (async function* () {
        yield JSON.stringify({ type: "end", data: "", timestamp: 1 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      for await (const _ of mgr.logs({ follow: false })) { break }

      expect(mockClient.streamGet).toHaveBeenCalledWith(
        expect.stringContaining("follow=false"),
      )
    })

    it("stops on end event", async () => {
      const mockGen = (async function* () {
        yield JSON.stringify({ type: "stdout", data: "line1", timestamp: 1 })
        yield JSON.stringify({ type: "end", data: "", timestamp: 2 })
        yield JSON.stringify({ type: "stdout", data: "should not appear", timestamp: 3 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      const events = []
      for await (const event of mgr.logs()) {
        events.push(event)
      }

      expect(events).toHaveLength(2)
      expect(events[1].type).toBe("end")
    })

    it("handles unparseable lines gracefully", async () => {
      const mockGen = (async function* () {
        yield "not-json"
        yield JSON.stringify({ type: "end", data: "", timestamp: 1 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      const events = []
      for await (const event of mgr.logs()) {
        events.push(event)
      }

      expect(events[0].type).toBe("stdout")
      expect(events[0].data).toBe("not-json")
    })
  })

  describe("metrics", () => {
    it("calls streamGet with correct path", async () => {
      const mockGen = (async function* () {
        yield JSON.stringify({ sandboxId: "sbx_test123", cpuPercent: 5.2 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      const metrics = []
      for await (const m of mgr.metrics()) {
        metrics.push(m)
      }

      expect(mockClient.streamGet).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/stream/metrics`,
      )
      expect(metrics).toHaveLength(1)
      expect(metrics[0].cpuPercent).toBe(5.2)
    })

    it("passes interval as query param", async () => {
      const mockGen = (async function* () {
        yield JSON.stringify({ sandboxId: "sbx_test123", cpuPercent: 1 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      for await (const _ of mgr.metrics(2)) { break }

      expect(mockClient.streamGet).toHaveBeenCalledWith(
        expect.stringContaining("interval=2"),
      )
    })

    it("skips unparseable metric lines", async () => {
      const mockGen = (async function* () {
        yield "bad-data"
        yield JSON.stringify({ sandboxId: "sbx_test123", cpuPercent: 3 })
      })();
      (mockClient.streamGet as any).mockReturnValue(mockGen)

      const mgr = new StreamManager(mockClient, sandboxId)
      const metrics = []
      for await (const m of mgr.metrics()) {
        metrics.push(m)
      }

      expect(metrics).toHaveLength(1)
      expect(metrics[0].cpuPercent).toBe(3)
    })
  })
})
