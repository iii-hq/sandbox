import { describe, it, expect, vi, beforeEach } from "vitest"
import { TerminalManager } from "../../packages/sdk/src/terminal.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("TerminalManager", () => {
  let mockClient: HttpClient
  let terminal: TerminalManager

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient
    terminal = new TerminalManager(mockClient, "sbx_test")
  })

  describe("create", () => {
    it("calls correct endpoint with default options", async () => {
      const session = {
        sessionId: "term_abc",
        sandboxId: "sbx_test",
        execId: "exec_123",
        cols: 80,
        rows: 24,
        shell: "/bin/sh",
        status: "created",
        createdAt: 1700000000000,
      }
      ;(mockClient.post as any).mockResolvedValue(session)
      const result = await terminal.create()

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/terminal",
        { cols: 80, rows: 24, shell: undefined },
      )
      expect(result.sessionId).toBe("term_abc")
      expect(result.cols).toBe(80)
      expect(result.rows).toBe(24)
    })

    it("passes custom cols and rows", async () => {
      const session = {
        sessionId: "term_def",
        sandboxId: "sbx_test",
        execId: "exec_456",
        cols: 120,
        rows: 40,
        shell: "/bin/bash",
        status: "created",
        createdAt: 1700000000000,
      }
      ;(mockClient.post as any).mockResolvedValue(session)
      const result = await terminal.create({ cols: 120, rows: 40, shell: "/bin/bash" })

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/terminal",
        { cols: 120, rows: 40, shell: "/bin/bash" },
      )
      expect(result.cols).toBe(120)
      expect(result.rows).toBe(40)
    })
  })

  describe("resize", () => {
    it("calls correct endpoint with session id", async () => {
      ;(mockClient.post as any).mockResolvedValue({ cols: 100, rows: 50 })
      const result = await terminal.resize("term_abc", 100, 50)

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/terminal/term_abc/resize",
        { cols: 100, rows: 50 },
      )
      expect(result.cols).toBe(100)
      expect(result.rows).toBe(50)
    })
  })

  describe("close", () => {
    it("calls correct endpoint with session id", async () => {
      ;(mockClient.del as any).mockResolvedValue({ closed: "term_abc" })
      const result = await terminal.close("term_abc")

      expect(mockClient.del).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/terminal/term_abc",
      )
      expect(result.closed).toBe("term_abc")
    })
  })
})
