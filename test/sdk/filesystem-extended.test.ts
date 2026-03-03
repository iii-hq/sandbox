import { describe, it, expect, vi, beforeEach } from "vitest"
import { FileSystem } from "../../packages/sdk/src/filesystem.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("FileSystem Extended", () => {
  let mockClient: HttpClient
  let fs: FileSystem

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient
    fs = new FileSystem(mockClient, "sbx_ext")
  })

  describe("read", () => {
    it("calls correct endpoint with path", async () => {
      ;(mockClient.post as any).mockResolvedValue("hello world")
      const result = await fs.read("/workspace/main.py")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/read",
        { path: "/workspace/main.py" },
      )
      expect(result).toBe("hello world")
    })

    it("reads nested paths", async () => {
      ;(mockClient.post as any).mockResolvedValue("content")
      await fs.read("/workspace/src/lib/utils.ts")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/read",
        { path: "/workspace/src/lib/utils.ts" },
      )
    })

    it("returns empty string for empty file", async () => {
      ;(mockClient.post as any).mockResolvedValue("")
      const result = await fs.read("/workspace/empty.txt")

      expect(result).toBe("")
    })

    it("returns multiline content", async () => {
      ;(mockClient.post as any).mockResolvedValue("line1\nline2\nline3")
      const result = await fs.read("/workspace/multi.txt")

      expect(result).toBe("line1\nline2\nline3")
    })

    it("propagates errors", async () => {
      ;(mockClient.post as any).mockRejectedValue(new Error("POST failed: 404"))
      await expect(fs.read("/workspace/missing.txt")).rejects.toThrow("POST failed: 404")
    })
  })

  describe("write", () => {
    it("sends path and content to write endpoint", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.write("/workspace/output.txt", "data")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/write",
        { path: "/workspace/output.txt", content: "data" },
      )
    })

    it("writes empty content", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.write("/workspace/blank.txt", "")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/write",
        { path: "/workspace/blank.txt", content: "" },
      )
    })

    it("writes multiline content", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.write("/workspace/code.py", "import os\nprint(os.getcwd())")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/write",
        { path: "/workspace/code.py", content: "import os\nprint(os.getcwd())" },
      )
    })

    it("propagates errors", async () => {
      ;(mockClient.post as any).mockRejectedValue(new Error("POST failed: 403"))
      await expect(fs.write("/workspace/denied.txt", "data")).rejects.toThrow("POST failed: 403")
    })
  })

  describe("delete", () => {
    it("sends path to delete endpoint", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.delete("/workspace/old.txt")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/delete",
        { path: "/workspace/old.txt" },
      )
    })

    it("deletes nested file", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.delete("/workspace/src/temp.js")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/delete",
        { path: "/workspace/src/temp.js" },
      )
    })

    it("propagates errors", async () => {
      ;(mockClient.post as any).mockRejectedValue(new Error("POST failed: 404"))
      await expect(fs.delete("/workspace/missing.txt")).rejects.toThrow("POST failed: 404")
    })
  })

  describe("list", () => {
    it("defaults to /workspace path", async () => {
      const files = [
        { name: "a.py", path: "/workspace/a.py", size: 100, isDirectory: false, modifiedAt: 1000 },
        { name: "b.py", path: "/workspace/b.py", size: 200, isDirectory: false, modifiedAt: 2000 },
      ]
      ;(mockClient.post as any).mockResolvedValue(files)
      const result = await fs.list()

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/list",
        { path: "/workspace" },
      )
      expect(result).toHaveLength(2)
    })

    it("uses custom path when provided", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      await fs.list("/workspace/src")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/list",
        { path: "/workspace/src" },
      )
    })

    it("returns directories in listing", async () => {
      const items = [
        { name: "src", path: "/workspace/src", size: 0, isDirectory: true, modifiedAt: 500 },
        { name: "main.py", path: "/workspace/main.py", size: 150, isDirectory: false, modifiedAt: 600 },
      ]
      ;(mockClient.post as any).mockResolvedValue(items)
      const result = await fs.list()

      expect(result[0].isDirectory).toBe(true)
      expect(result[1].isDirectory).toBe(false)
    })

    it("returns empty array for empty directory", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      const result = await fs.list("/workspace/empty-dir")

      expect(result).toEqual([])
    })
  })

  describe("search", () => {
    it("defaults dir to /workspace", async () => {
      ;(mockClient.post as any).mockResolvedValue(["/workspace/a.py", "/workspace/b.py"])
      const result = await fs.search("*.py")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/search",
        { pattern: "*.py", dir: "/workspace" },
      )
      expect(result).toHaveLength(2)
    })

    it("uses custom dir when provided", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      await fs.search("*.ts", "/workspace/src")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/search",
        { pattern: "*.ts", dir: "/workspace/src" },
      )
    })

    it("returns matching file paths as strings", async () => {
      const matches = ["/workspace/index.js", "/workspace/src/app.js", "/workspace/lib/util.js"]
      ;(mockClient.post as any).mockResolvedValue(matches)
      const result = await fs.search("*.js")

      expect(result).toEqual(matches)
    })

    it("returns empty array for no matches", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      const result = await fs.search("*.rs")

      expect(result).toEqual([])
    })

    it("searches with glob patterns", async () => {
      ;(mockClient.post as any).mockResolvedValue([])
      await fs.search("**/*.test.ts", "/workspace")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/search",
        { pattern: "**/*.test.ts", dir: "/workspace" },
      )
    })
  })

  describe("upload", () => {
    it("sends base64 content to upload endpoint", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.upload("/workspace/image.png", "iVBORw0KGgo=")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/upload",
        { path: "/workspace/image.png", content: "iVBORw0KGgo=" },
      )
    })

    it("uploads to nested path", async () => {
      ;(mockClient.post as any).mockResolvedValue(undefined)
      await fs.upload("/workspace/data/model.bin", "AAAA")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/upload",
        { path: "/workspace/data/model.bin", content: "AAAA" },
      )
    })

    it("propagates errors", async () => {
      ;(mockClient.post as any).mockRejectedValue(new Error("POST failed: 413"))
      await expect(fs.upload("/workspace/big.bin", "huge-content")).rejects.toThrow("POST failed: 413")
    })
  })

  describe("download", () => {
    it("returns content from download endpoint", async () => {
      ;(mockClient.post as any).mockResolvedValue("aGVsbG8=")
      const result = await fs.download("/workspace/data.bin")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/download",
        { path: "/workspace/data.bin" },
      )
      expect(result).toBe("aGVsbG8=")
    })

    it("downloads nested path", async () => {
      ;(mockClient.post as any).mockResolvedValue("Y29udGVudA==")
      const result = await fs.download("/workspace/out/result.csv")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_ext/files/download",
        { path: "/workspace/out/result.csv" },
      )
      expect(result).toBe("Y29udGVudA==")
    })

    it("propagates errors", async () => {
      ;(mockClient.post as any).mockRejectedValue(new Error("POST failed: 404"))
      await expect(fs.download("/workspace/gone.bin")).rejects.toThrow("POST failed: 404")
    })
  })

  describe("sandboxId in all endpoints", () => {
    it("includes sandboxId in every method call", async () => {
      ;(mockClient.post as any).mockResolvedValue("ok")
      const customFs = new FileSystem(mockClient, "sbx_custom999")

      await customFs.read("/workspace/a.txt")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/read",
        expect.anything(),
      )

      await customFs.write("/workspace/b.txt", "x")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/write",
        expect.anything(),
      )

      await customFs.delete("/workspace/c.txt")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/delete",
        expect.anything(),
      )

      await customFs.list("/workspace")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/list",
        expect.anything(),
      )

      await customFs.search("*.py")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/search",
        expect.anything(),
      )

      await customFs.upload("/workspace/d.bin", "AA==")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/upload",
        expect.anything(),
      )

      await customFs.download("/workspace/e.bin")
      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_custom999/files/download",
        expect.anything(),
      )
    })
  })

  describe("all methods use POST", () => {
    it("every FileSystem method uses client.post", async () => {
      ;(mockClient.post as any).mockResolvedValue("ok")

      await fs.read("/workspace/a")
      await fs.write("/workspace/b", "c")
      await fs.delete("/workspace/d")
      await fs.list()
      await fs.search("*")
      await fs.upload("/workspace/e", "f")
      await fs.download("/workspace/g")

      expect(mockClient.post).toHaveBeenCalledTimes(7)
      expect(mockClient.get).not.toHaveBeenCalled()
      expect(mockClient.del).not.toHaveBeenCalled()
    })
  })
})
