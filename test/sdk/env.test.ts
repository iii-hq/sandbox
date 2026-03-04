import { describe, it, expect, vi, beforeEach } from "vitest"
import { EnvManager } from "../../packages/sdk/src/env.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("EnvManager", () => {
  let mockClient: HttpClient
  let env: EnvManager

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient
    env = new EnvManager(mockClient, "sbx_test")
  })

  describe("get", () => {
    it("calls correct endpoint with key", async () => {
      ;(mockClient.post as any).mockResolvedValue({ key: "FOO", value: "bar", exists: true })
      const result = await env.get("FOO")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/env/get",
        { key: "FOO" },
      )
      expect(result).toEqual({ key: "FOO", value: "bar", exists: true })
    })

    it("returns exists=false for missing variable", async () => {
      ;(mockClient.post as any).mockResolvedValue({ key: "MISSING", value: null, exists: false })
      const result = await env.get("MISSING")

      expect(result.exists).toBe(false)
      expect(result.value).toBeNull()
    })
  })

  describe("set", () => {
    it("calls correct endpoint with vars", async () => {
      ;(mockClient.post as any).mockResolvedValue({ set: ["A", "B"], count: 2 })
      const result = await env.set({ A: "1", B: "2" })

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/env",
        { vars: { A: "1", B: "2" } },
      )
      expect(result).toEqual({ set: ["A", "B"], count: 2 })
    })
  })

  describe("list", () => {
    it("calls correct endpoint", async () => {
      const mockVars = { HOME: "/root", PATH: "/usr/bin" }
      ;(mockClient.get as any).mockResolvedValue({ vars: mockVars, count: 2 })
      const result = await env.list()

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/env",
      )
      expect(result.vars).toEqual(mockVars)
      expect(result.count).toBe(2)
    })

    it("returns empty vars when sandbox has none", async () => {
      ;(mockClient.get as any).mockResolvedValue({ vars: {}, count: 0 })
      const result = await env.list()

      expect(result.vars).toEqual({})
      expect(result.count).toBe(0)
    })
  })

  describe("delete", () => {
    it("calls correct endpoint with key", async () => {
      ;(mockClient.post as any).mockResolvedValue({ deleted: "OLD_VAR" })
      const result = await env.delete("OLD_VAR")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/env/delete",
        { key: "OLD_VAR" },
      )
      expect(result).toEqual({ deleted: "OLD_VAR" })
    })
  })
})
