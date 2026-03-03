import { describe, it, expect, vi, beforeEach } from "vitest"
import { GitManager } from "../../packages/sdk/src/git.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("GitManager", () => {
  let mockClient: HttpClient
  const sandboxId = "sbx_test123"

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient
  })

  describe("clone", () => {
    it("posts to correct endpoint", async () => {
      const expected = { exitCode: 0, stdout: "Cloning...", stderr: "", duration: 100 };
      (mockClient.post as any).mockResolvedValue(expected)
      const git = new GitManager(mockClient, sandboxId)

      const result = await git.clone("https://github.com/test/repo.git")

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/clone`,
        { url: "https://github.com/test/repo.git" },
      )
      expect(result).toEqual(expected)
    })

    it("passes options", async () => {
      (mockClient.post as any).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 50 })
      const git = new GitManager(mockClient, sandboxId)

      await git.clone("https://github.com/test/repo.git", { branch: "dev", depth: 1 })

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/clone`,
        { url: "https://github.com/test/repo.git", branch: "dev", depth: 1 },
      )
    })
  })

  describe("status", () => {
    it("gets status without path", async () => {
      const expected = { branch: "main", clean: true, files: [] };
      (mockClient.get as any).mockResolvedValue(expected)
      const git = new GitManager(mockClient, sandboxId)

      const result = await git.status()

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/status`,
      )
      expect(result).toEqual(expected)
    })

    it("gets status with path", async () => {
      (mockClient.get as any).mockResolvedValue({ branch: "main", clean: true, files: [] })
      const git = new GitManager(mockClient, sandboxId)

      await git.status("/workspace/myrepo")

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/status?path=%2Fworkspace%2Fmyrepo`,
      )
    })
  })

  describe("commit", () => {
    it("posts commit with message", async () => {
      const expected = { exitCode: 0, stdout: "[main abc123] test", stderr: "", duration: 50 };
      (mockClient.post as any).mockResolvedValue(expected)
      const git = new GitManager(mockClient, sandboxId)

      const result = await git.commit("test commit")

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/commit`,
        { message: "test commit" },
      )
      expect(result).toEqual(expected)
    })

    it("passes all option", async () => {
      (mockClient.post as any).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 50 })
      const git = new GitManager(mockClient, sandboxId)

      await git.commit("add all", { all: true })

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/commit`,
        { message: "add all", all: true },
      )
    })
  })

  describe("diff", () => {
    it("gets diff with no options", async () => {
      (mockClient.get as any).mockResolvedValue({ diff: "+added" })
      const git = new GitManager(mockClient, sandboxId)

      const result = await git.diff()

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/diff`,
      )
      expect(result.diff).toBe("+added")
    })

    it("gets staged diff", async () => {
      (mockClient.get as any).mockResolvedValue({ diff: "" })
      const git = new GitManager(mockClient, sandboxId)

      await git.diff({ staged: true })

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/diff?staged=true`,
      )
    })
  })

  describe("log", () => {
    it("gets log entries", async () => {
      const expected = {
        entries: [{ hash: "abc", message: "test", author: "John", date: "2026-01-01" }],
      };
      (mockClient.get as any).mockResolvedValue(expected)
      const git = new GitManager(mockClient, sandboxId)

      const result = await git.log()

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/log`,
      )
      expect(result.entries).toHaveLength(1)
    })

    it("passes count option", async () => {
      (mockClient.get as any).mockResolvedValue({ entries: [] })
      const git = new GitManager(mockClient, sandboxId)

      await git.log({ count: 5 })

      expect(mockClient.get).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/log?count=5`,
      )
    })
  })

  describe("branch", () => {
    it("lists branches", async () => {
      const expected = { branches: ["main", "develop"], current: "main" };
      (mockClient.post as any).mockResolvedValue(expected)
      const git = new GitManager(mockClient, sandboxId)

      const result = await git.branch()

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/branch`,
        {},
      )
      expect(result).toEqual(expected)
    })
  })

  describe("checkout", () => {
    it("checks out a ref", async () => {
      (mockClient.post as any).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 50 })
      const git = new GitManager(mockClient, sandboxId)

      await git.checkout("develop")

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/checkout`,
        { ref: "develop", path: undefined },
      )
    })
  })

  describe("push", () => {
    it("pushes with defaults", async () => {
      (mockClient.post as any).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 50 })
      const git = new GitManager(mockClient, sandboxId)

      await git.push()

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/push`,
        {},
      )
    })
  })

  describe("pull", () => {
    it("pulls with defaults", async () => {
      (mockClient.post as any).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 50 })
      const git = new GitManager(mockClient, sandboxId)

      await git.pull()

      expect(mockClient.post).toHaveBeenCalledWith(
        `/sandbox/sandboxes/${sandboxId}/git/pull`,
        {},
      )
    })
  })
})
