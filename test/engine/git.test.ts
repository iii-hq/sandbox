import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", async (importOriginal) => {
  const original = await importOriginal() as any
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  }
})

const mockExecInContainer = vi.fn()
const mockGetDocker = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => mockGetDocker(),
}))

import { registerGitFunctions } from "../../packages/engine/src/functions/git.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("Git Functions", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, any>

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
    name: "test",
    image: "python:3.12-slim",
    status: "running",
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: {},
    metadata: {},
  }

  beforeEach(() => {
    handlers = new Map()
    kvStore = new Map()
    kvStore.set("sbx_test", runningSandbox)

    const kv = {
      get: vi.fn(async (_scope: string, key: string) => kvStore.get(key) ?? null),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    }

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
    }

    mockGetDocker.mockReturnValue({
      getContainer: () => ({ id: "container-1" }),
    })

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 50,
    })

    registerGitFunctions(sdk, kv as any, config)
  })

  describe("git::clone", () => {
    it("clones a repository", async () => {
      const handler = handlers.get("git::clone")!
      await handler({ id: "sbx_test", url: "https://github.com/test/repo.git" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone "https://github.com/test/repo.git"'],
        30000,
      )
    })

    it("clones with branch and depth", async () => {
      const handler = handlers.get("git::clone")!
      await handler({
        id: "sbx_test",
        url: "https://github.com/test/repo.git",
        branch: "develop",
        depth: 1,
      })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone --branch "develop" --depth 1 "https://github.com/test/repo.git"'],
        30000,
      )
    })

    it("clones to a specific path", async () => {
      const handler = handlers.get("git::clone")!
      await handler({
        id: "sbx_test",
        url: "https://github.com/test/repo.git",
        path: "/workspace/myrepo",
      })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'git clone "https://github.com/test/repo.git" "/workspace/myrepo"'],
        30000,
      )
    })

    it("throws for non-existent sandbox", async () => {
      const handler = handlers.get("git::clone")!
      await expect(
        handler({ id: "sbx_missing", url: "https://github.com/test/repo.git" }),
      ).rejects.toThrow("Sandbox not found")
    })

    it("throws for non-running sandbox", async () => {
      kvStore.set("sbx_paused", { ...runningSandbox, id: "sbx_paused", status: "paused" })
      const handler = handlers.get("git::clone")!
      await expect(
        handler({ id: "sbx_paused", url: "https://github.com/test/repo.git" }),
      ).rejects.toThrow("not running")
    })
  })

  describe("git::status", () => {
    it("returns clean status", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({ exitCode: 0, stdout: "main\n", stderr: "", duration: 10 })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10 })

      const handler = handlers.get("git::status")!
      const result = await handler({ id: "sbx_test" })

      expect(result.branch).toBe("main")
      expect(result.clean).toBe(true)
      expect(result.files).toEqual([])
    })

    it("parses porcelain output", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({ exitCode: 0, stdout: "main\n", stderr: "", duration: 10 })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: " M src/index.ts\n?? newfile.txt\n",
          stderr: "",
          duration: 10,
        })

      const handler = handlers.get("git::status")!
      const result = await handler({ id: "sbx_test" })

      expect(result.branch).toBe("main")
      expect(result.clean).toBe(false)
      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({ status: "M", path: "src/index.ts" })
      expect(result.files[1]).toEqual({ status: "??", path: "newfile.txt" })
    })

    it("uses custom path", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({ exitCode: 0, stdout: "main\n", stderr: "", duration: 10 })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10 })

      const handler = handlers.get("git::status")!
      await handler({ id: "sbx_test", path: "/workspace/myrepo" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace/myrepo" && git rev-parse --abbrev-ref HEAD'],
        30000,
      )
    })
  })

  describe("git::commit", () => {
    it("commits with message", async () => {
      const handler = handlers.get("git::commit")!
      await handler({ id: "sbx_test", message: "Initial commit" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", "cd \"/workspace\" && git commit -m 'Initial commit'"],
        30000,
      )
    })

    it("stages all and commits when all=true", async () => {
      const handler = handlers.get("git::commit")!
      await handler({ id: "sbx_test", message: "Add files", all: true })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", "cd \"/workspace\" && git add -A && git commit -m 'Add files'"],
        30000,
      )
    })

    it("escapes single quotes in message", async () => {
      const handler = handlers.get("git::commit")!
      await handler({ id: "sbx_test", message: "it's a test" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", "cd \"/workspace\" && git commit -m 'it'\\''s a test'"],
        30000,
      )
    })
  })

  describe("git::diff", () => {
    it("shows unstaged diff", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "diff --git a/file.ts b/file.ts\n+added line\n",
        stderr: "",
        duration: 10,
      })

      const handler = handlers.get("git::diff")!
      const result = await handler({ id: "sbx_test" })

      expect(result.diff).toContain("+added line")
    })

    it("shows staged diff", async () => {
      const handler = handlers.get("git::diff")!
      await handler({ id: "sbx_test", staged: true })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git diff --staged'],
        30000,
      )
    })

    it("diffs a specific file", async () => {
      const handler = handlers.get("git::diff")!
      await handler({ id: "sbx_test", file: "src/main.ts" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git diff "src/main.ts"'],
        30000,
      )
    })
  })

  describe("git::log", () => {
    it("returns parsed log entries", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "abc123\tInitial commit\tJohn\t2026-01-01T00:00:00+00:00\ndef456\tSecond commit\tJane\t2026-01-02T00:00:00+00:00\n",
        stderr: "",
        duration: 10,
      })

      const handler = handlers.get("git::log")!
      const result = await handler({ id: "sbx_test" })

      expect(result.entries).toHaveLength(2)
      expect(result.entries[0]).toEqual({
        hash: "abc123",
        message: "Initial commit",
        author: "John",
        date: "2026-01-01T00:00:00+00:00",
      })
    })

    it("uses custom count", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 10,
      })

      const handler = handlers.get("git::log")!
      await handler({ id: "sbx_test", count: 5 })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git log --format="%H\t%s\t%an\t%aI" -5'],
        30000,
      )
    })

    it("defaults to 10 entries", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 10,
      })

      const handler = handlers.get("git::log")!
      await handler({ id: "sbx_test" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git log --format="%H\t%s\t%an\t%aI" -10'],
        30000,
      )
    })
  })

  describe("git::branch", () => {
    it("lists branches", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "* main\n  develop\n  remotes/origin/main\n",
        stderr: "",
        duration: 10,
      })

      const handler = handlers.get("git::branch")!
      const result = await handler({ id: "sbx_test" })

      expect(result.current).toBe("main")
      expect(result.branches).toContain("main")
      expect(result.branches).toContain("develop")
    })

    it("creates a new branch", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10 })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "  main\n* feature\n",
          stderr: "",
          duration: 10,
        })

      const handler = handlers.get("git::branch")!
      const result = await handler({ id: "sbx_test", name: "feature" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git checkout -b "feature"'],
        30000,
      )
      expect(result.current).toBe("feature")
    })

    it("deletes a branch", async () => {
      mockExecInContainer
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10 })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "* main\n",
          stderr: "",
          duration: 10,
        })

      const handler = handlers.get("git::branch")!
      await handler({ id: "sbx_test", name: "old-branch", delete: true })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git branch -d "old-branch"'],
        30000,
      )
    })
  })

  describe("git::checkout", () => {
    it("checks out a branch", async () => {
      const handler = handlers.get("git::checkout")!
      await handler({ id: "sbx_test", ref: "develop" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git checkout "develop"'],
        30000,
      )
    })

    it("checks out with custom path", async () => {
      const handler = handlers.get("git::checkout")!
      await handler({ id: "sbx_test", ref: "main", path: "/workspace/myrepo" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace/myrepo" && git checkout "main"'],
        30000,
      )
    })
  })

  describe("git::push", () => {
    it("pushes with defaults", async () => {
      const handler = handlers.get("git::push")!
      await handler({ id: "sbx_test" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git push'],
        30000,
      )
    })

    it("pushes to specific remote and branch", async () => {
      const handler = handlers.get("git::push")!
      await handler({ id: "sbx_test", remote: "origin", branch: "main" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git push "origin" "main"'],
        30000,
      )
    })

    it("pushes with force flag", async () => {
      const handler = handlers.get("git::push")!
      await handler({ id: "sbx_test", force: true })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git push --force'],
        30000,
      )
    })
  })

  describe("git::pull", () => {
    it("pulls with defaults", async () => {
      const handler = handlers.get("git::pull")!
      await handler({ id: "sbx_test" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git pull'],
        30000,
      )
    })

    it("pulls from specific remote and branch", async () => {
      const handler = handlers.get("git::pull")!
      await handler({ id: "sbx_test", remote: "upstream", branch: "main" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'cd "/workspace" && git pull "upstream" "main"'],
        30000,
      )
    })
  })
})
