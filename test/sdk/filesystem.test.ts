import { describe, it, expect, vi, beforeEach } from "vitest"
import { FileSystem } from "../../packages/sdk/src/filesystem.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("FileSystem", () => {
  let mockClient: HttpClient
  let fs: FileSystem

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient
    fs = new FileSystem(mockClient, "sbx_test")
  })

  describe("read", () => {
    it("calls correct endpoint with path", async () => {
      ;(mockClient.post as any).mockResolvedValue("file content")
      const result = await fs.read("/workspace/test.py")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/read",
        { path: "/workspace/test.py" },
      )
      expect(result).toBe("file content")
    })
  })

  describe("write", () => {
    it("calls correct endpoint with path and content", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.write("/workspace/out.txt", "hello world")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/write",
        { path: "/workspace/out.txt", content: "hello world" },
      )
    })
  })

  describe("delete", () => {
    it("calls correct endpoint", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.delete("/workspace/old.txt")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/delete",
        { path: "/workspace/old.txt" },
      )
    })
  })

  describe("list", () => {
    it("uses default path /workspace", async () => {
      const files = [{ name: "a.py", path: "/workspace/a.py", size: 100, isDirectory: false, modifiedAt: 1 }]
      ;(mockClient.post as any).mockResolvedValue(files)
      const result = await fs.list()

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/list",
        { path: "/workspace" },
      )
      expect(result).toEqual(files)
    })

    it("uses custom path when provided", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      await fs.list("/workspace/src")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/list",
        { path: "/workspace/src" },
      )
    })
  })

  describe("search", () => {
    it("uses default dir /workspace", async () => {
      ;(mockClient.post as any).mockResolvedValue(["/workspace/a.py"])
      await fs.search("*.py")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/search",
        { pattern: "*.py", dir: "/workspace" },
      )
    })

    it("uses custom dir when provided", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      await fs.search("*.ts", "/workspace/src")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/search",
        { pattern: "*.ts", dir: "/workspace/src" },
      )
    })
  })

  describe("upload", () => {
    it("sends base64 content", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.upload("/workspace/data.bin", "aGVsbG8=")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/upload",
        { path: "/workspace/data.bin", content: "aGVsbG8=" },
      )
    })
  })

  describe("download", () => {
    it("returns base64 content", async () => {
      ;(mockClient.post as any).mockResolvedValue("aGVsbG8=")
      const result = await fs.download("/workspace/data.bin")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/files/download",
        { path: "/workspace/data.bin" },
      )
      expect(result).toBe("aGVsbG8=")
    })
  })
})
