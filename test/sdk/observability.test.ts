import { describe, it, expect, vi, beforeEach } from "vitest"
import { ObservabilityClient } from "../../packages/sdk/src/observability.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("ObservabilityClient", () => {
  let mockClient: HttpClient
  let observability: ObservabilityClient

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient

    observability = new ObservabilityClient(mockClient)
  })

  describe("traces", () => {
    it("fetches traces without filters", async () => {
      const expected = { traces: [], total: 0 };
      (mockClient.get as any).mockResolvedValue(expected)

      const result = await observability.traces()

      expect(mockClient.get).toHaveBeenCalledWith("/sandbox/observability/traces")
      expect(result).toEqual(expected)
    })

    it("passes sandboxId filter as query param", async () => {
      (mockClient.get as any).mockResolvedValue({ traces: [], total: 0 })

      await observability.traces({ sandboxId: "sbx_abc" })

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/observability/traces?sandboxId=sbx_abc",
      )
    })

    it("passes all filters as query params", async () => {
      (mockClient.get as any).mockResolvedValue({ traces: [], total: 0 })

      await observability.traces({
        sandboxId: "sbx_abc",
        functionId: "cmd::run",
        limit: 10,
      })

      const url = (mockClient.get as any).mock.calls[0][0] as string
      expect(url).toContain("sandboxId=sbx_abc")
      expect(url).toContain("functionId=cmd%3A%3Arun")
      expect(url).toContain("limit=10")
    })
  })

  describe("metrics", () => {
    it("fetches metrics", async () => {
      const expected = {
        totalRequests: 100,
        totalErrors: 5,
        avgDuration: 50,
        p95Duration: 120,
        activeSandboxes: 3,
        functionCounts: { "sandbox::create": 10 },
      };
      (mockClient.get as any).mockResolvedValue(expected)

      const result = await observability.metrics()

      expect(mockClient.get).toHaveBeenCalledWith("/sandbox/observability/metrics")
      expect(result).toEqual(expected)
    })
  })

  describe("clear", () => {
    it("clears traces with before timestamp", async () => {
      (mockClient.post as any).mockResolvedValue({ cleared: 5 })

      const result = await observability.clear(1000)

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/observability/clear",
        { before: 1000 },
      )
      expect(result.cleared).toBe(5)
    })

    it("clears all traces when no before given", async () => {
      (mockClient.post as any).mockResolvedValue({ cleared: 10 })

      const result = await observability.clear()

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/observability/clear",
        { before: undefined },
      )
      expect(result.cleared).toBe(10)
    })
  })
})
