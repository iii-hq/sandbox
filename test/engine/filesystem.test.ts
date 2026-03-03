import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}))

const mockExecInContainer = vi.fn()
const mockCopyToContainer = vi.fn()
const mockCopyFromContainer = vi.fn()
const mockListContainerDir = vi.fn()
const mockSearchInContainer = vi.fn()
const mockGetFileInfo = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  copyToContainer: (...args: any[]) => mockCopyToContainer(...args),
  copyFromContainer: (...args: any[]) => mockCopyFromContainer(...args),
  listContainerDir: (...args: any[]) => mockListContainerDir(...args),
  searchInContainer: (...args: any[]) => mockSearchInContainer(...args),
  getFileInfo: (...args: any[]) => mockGetFileInfo(...args),
  getDocker: () => ({
    getContainer: () => ({ id: "container-1" }),
  }),
}))

import { registerFilesystemFunctions } from "../../packages/engine/src/functions/filesystem.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("Filesystem Functions", () => {
  let handlers: Map<string, Function>

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
    maxFileSize: 10485760,
    cleanupOnExit: true,
  }

  const runningSandbox = {
    id: "sbx_test",
    status: "running",
  }

  beforeEach(() => {
    handlers = new Map()

    const kv = {
      get: vi.fn(async (_scope: string, key: string) => {
        if (key === "sbx_test") return runningSandbox
        if (key === "sbx_paused") return { id: "sbx_paused", status: "paused" }
        return null
      }),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    }

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
    }

    mockExecInContainer.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 10 })
    mockCopyToContainer.mockResolvedValue(undefined)
    mockCopyFromContainer.mockResolvedValue(Buffer.from("file content"))
    mockListContainerDir.mockResolvedValue([])
    mockSearchInContainer.mockResolvedValue([])
    mockGetFileInfo.mockResolvedValue([])

    registerFilesystemFunctions(sdk, kv as any, config)
  })

  describe("fs::read", () => {
    it("reads file content via exec cat", async () => {
      mockExecInContainer.mockResolvedValue({ exitCode: 0, stdout: "hello world", stderr: "", duration: 10 })
      const read = handlers.get("fs::read")!
      const result = await read({ id: "sbx_test", path: "/workspace/test.txt" })
      expect(result).toBe("hello world")
    })

    it("throws on read failure", async () => {
      mockExecInContainer.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "No such file", duration: 10 })
      const read = handlers.get("fs::read")!
      await expect(read({ id: "sbx_test", path: "/workspace/missing.txt" })).rejects.toThrow("Failed to read")
    })

    it("rejects path traversal", async () => {
      const read = handlers.get("fs::read")!
      await expect(read({ id: "sbx_test", path: "/etc/passwd" })).rejects.toThrow()
    })

    it("throws for non-running sandbox", async () => {
      const read = handlers.get("fs::read")!
      await expect(read({ id: "sbx_paused", path: "/workspace/a.txt" })).rejects.toThrow("not running")
    })

    it("throws for non-existent sandbox", async () => {
      const read = handlers.get("fs::read")!
      await expect(read({ id: "sbx_missing", path: "/workspace/a.txt" })).rejects.toThrow("not found")
    })
  })

  describe("fs::write", () => {
    it("writes file content via copyToContainer", async () => {
      const write = handlers.get("fs::write")!
      const result = await write({ id: "sbx_test", path: "/workspace/out.txt", content: "hello" })
      expect(result.success).toBe(true)
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/out.txt",
        Buffer.from("hello", "utf-8"),
      )
    })

    it("rejects path traversal", async () => {
      const write = handlers.get("fs::write")!
      await expect(write({ id: "sbx_test", path: "../../../etc/cron", content: "evil" })).rejects.toThrow()
    })
  })

  describe("fs::delete", () => {
    it("deletes a file", async () => {
      const del = handlers.get("fs::delete")!
      const result = await del({ id: "sbx_test", path: "/workspace/old.txt" })
      expect(result.success).toBe(true)
    })

    it("throws on delete failure", async () => {
      mockExecInContainer.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "Permission denied", duration: 10 })
      const del = handlers.get("fs::delete")!
      await expect(del({ id: "sbx_test", path: "/workspace/protected.txt" })).rejects.toThrow("Failed to delete")
    })
  })

  describe("fs::list", () => {
    it("lists directory with default path", async () => {
      mockListContainerDir.mockResolvedValue([
        { name: "a.py", path: "/workspace/a.py", size: 100, isDirectory: false, modifiedAt: 1000 },
      ])
      const list = handlers.get("fs::list")!
      const result = await list({ id: "sbx_test" })
      expect(result).toHaveLength(1)
      expect(mockListContainerDir).toHaveBeenCalledWith(expect.anything(), "/workspace")
    })

    it("lists directory with custom path", async () => {
      mockListContainerDir.mockResolvedValue([])
      const list = handlers.get("fs::list")!
      await list({ id: "sbx_test", path: "/workspace/src" })
      expect(mockListContainerDir).toHaveBeenCalledWith(expect.anything(), "/workspace/src")
    })
  })

  describe("fs::search", () => {
    it("searches files by pattern", async () => {
      mockSearchInContainer.mockResolvedValue(["/workspace/a.py", "/workspace/b.py"])
      const search = handlers.get("fs::search")!
      const result = await search({ id: "sbx_test", pattern: "*.py" })
      expect(result).toHaveLength(2)
    })

    it("uses custom directory", async () => {
      mockSearchInContainer.mockResolvedValue([])
      const search = handlers.get("fs::search")!
      await search({ id: "sbx_test", pattern: "*.ts", dir: "/workspace/src" })
      expect(mockSearchInContainer).toHaveBeenCalledWith(expect.anything(), "/workspace/src", "*.ts")
    })
  })

  describe("fs::upload", () => {
    it("uploads base64 content", async () => {
      const upload = handlers.get("fs::upload")!
      const result = await upload({ id: "sbx_test", path: "/workspace/data.bin", content: "aGVsbG8=" })
      expect(result.success).toBe(true)
      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/workspace/data.bin",
        Buffer.from("aGVsbG8=", "base64"),
      )
    })
  })

  describe("fs::download", () => {
    it("downloads file as base64", async () => {
      mockCopyFromContainer.mockResolvedValue(Buffer.from("hello"))
      const download = handlers.get("fs::download")!
      const result = await download({ id: "sbx_test", path: "/workspace/data.bin" })
      expect(result).toBe(Buffer.from("hello").toString("base64"))
    })
  })

  describe("fs::info", () => {
    it("gets file metadata", async () => {
      mockGetFileInfo.mockResolvedValue([
        { path: "/workspace/a.py", size: 100, permissions: "-rw-r--r--", owner: "root", group: "root", isDirectory: false, isSymlink: false, modifiedAt: 1000 },
      ])
      const info = handlers.get("fs::info")!
      const result = await info({ id: "sbx_test", paths: ["/workspace/a.py"] })
      expect(result).toHaveLength(1)
      expect(result[0].permissions).toBe("-rw-r--r--")
    })

    it("validates all paths", async () => {
      const info = handlers.get("fs::info")!
      await expect(info({ id: "sbx_test", paths: ["/workspace/a.py", "/etc/passwd"] })).rejects.toThrow()
    })
  })

  describe("fs::move", () => {
    it("moves files", async () => {
      const move = handlers.get("fs::move")!
      const result = await move({
        id: "sbx_test",
        moves: [{ from: "/workspace/a.py", to: "/workspace/b.py" }],
      })
      expect(result.success).toBe(true)
    })

    it("validates both source and dest paths", async () => {
      const move = handlers.get("fs::move")!
      await expect(move({
        id: "sbx_test",
        moves: [{ from: "/etc/passwd", to: "/workspace/stolen.txt" }],
      })).rejects.toThrow()
    })

    it("throws on move failure", async () => {
      mockExecInContainer.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "No such file", duration: 10 })
      const move = handlers.get("fs::move")!
      await expect(move({
        id: "sbx_test",
        moves: [{ from: "/workspace/missing.py", to: "/workspace/b.py" }],
      })).rejects.toThrow("Move failed")
    })
  })

  describe("fs::mkdir", () => {
    it("creates directories", async () => {
      const mkdir = handlers.get("fs::mkdir")!
      const result = await mkdir({ id: "sbx_test", paths: ["/workspace/new-dir"] })
      expect(result.success).toBe(true)
    })

    it("validates paths", async () => {
      const mkdir = handlers.get("fs::mkdir")!
      await expect(mkdir({ id: "sbx_test", paths: ["/tmp/evil"] })).rejects.toThrow()
    })
  })

  describe("fs::rmdir", () => {
    it("removes directories", async () => {
      const rmdir = handlers.get("fs::rmdir")!
      const result = await rmdir({ id: "sbx_test", paths: ["/workspace/old-dir"] })
      expect(result.success).toBe(true)
    })
  })

  describe("fs::chmod", () => {
    it("changes file permissions", async () => {
      const chmod = handlers.get("fs::chmod")!
      const result = await chmod({ id: "sbx_test", path: "/workspace/script.sh", mode: "755" })
      expect(result.success).toBe(true)
    })

    it("validates path", async () => {
      const chmod = handlers.get("fs::chmod")!
      await expect(chmod({ id: "sbx_test", path: "/etc/shadow", mode: "777" })).rejects.toThrow()
    })
  })
})
