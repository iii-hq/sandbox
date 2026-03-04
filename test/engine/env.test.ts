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

import { registerEnvFunctions } from "../../packages/engine/src/functions/env.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("Env Functions", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, any>
  let kv: any

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
    defaultImage: "python:3.12-slim",
    ttlSweepInterval: "*/30 * * * * *",
    metricsInterval: "*/60 * * * * *",
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
    kvStore.set("sbx_test", { ...runningSandbox })

    kv = {
      get: vi.fn(async (_scope: string, key: string) => kvStore.get(key) ?? null),
      set: vi.fn(async (_scope: string, key: string, value: any) => {
        kvStore.set(key, value)
      }),
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
      duration: 10,
    })

    registerEnvFunctions(sdk, kv as any, config)
  })

  describe("env::get", () => {
    it("returns value when variable exists", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "hello\n",
        stderr: "",
        duration: 10,
      })

      const fn = handlers.get("env::get")!
      const result = await fn({ id: "sbx_test", key: "MY_VAR" })

      expect(result).toEqual({ key: "MY_VAR", value: "hello", exists: true })
    })

    it("returns exists=false when variable is not set", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "",
        duration: 10,
      })

      const fn = handlers.get("env::get")!
      const result = await fn({ id: "sbx_test", key: "MISSING" })

      expect(result).toEqual({ key: "MISSING", value: null, exists: false })
    })

    it("throws for non-existent sandbox", async () => {
      const fn = handlers.get("env::get")!
      await expect(fn({ id: "sbx_missing", key: "X" })).rejects.toThrow("Sandbox not found")
    })

    it("throws for non-running sandbox", async () => {
      kvStore.set("sbx_paused", { ...runningSandbox, id: "sbx_paused", status: "paused" })
      const fn = handlers.get("env::get")!
      await expect(fn({ id: "sbx_paused", key: "X" })).rejects.toThrow("not running")
    })

    it("calls printenv with quoted key", async () => {
      mockExecInContainer.mockResolvedValue({ exitCode: 0, stdout: "val\n", stderr: "", duration: 10 })
      const fn = handlers.get("env::get")!
      await fn({ id: "sbx_test", key: "FOO" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", 'printenv "FOO"'],
        10000,
      )
    })
  })

  describe("env::set", () => {
    it("sets a single variable", async () => {
      const fn = handlers.get("env::set")!
      const result = await fn({ id: "sbx_test", vars: { NODE_ENV: "production" } })

      expect(result).toEqual({ set: ["NODE_ENV"], count: 1 })
    })

    it("sets multiple variables", async () => {
      const fn = handlers.get("env::set")!
      const result = await fn({
        id: "sbx_test",
        vars: { A: "1", B: "2", C: "3" },
      })

      expect(result).toEqual({ set: ["A", "B", "C"], count: 3 })
    })

    it("persists vars in sandbox metadata", async () => {
      const fn = handlers.get("env::set")!
      await fn({ id: "sbx_test", vars: { KEY: "value" } })

      expect(kv.set).toHaveBeenCalledWith(
        "sandbox",
        "sbx_test",
        expect.objectContaining({
          metadata: expect.objectContaining({
            env: JSON.stringify({ KEY: "value" }),
          }),
        }),
      )
    })

    it("merges with existing metadata env", async () => {
      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: { env: JSON.stringify({ EXISTING: "old" }) },
      })

      const fn = handlers.get("env::set")!
      await fn({ id: "sbx_test", vars: { NEW: "val" } })

      expect(kv.set).toHaveBeenCalledWith(
        "sandbox",
        "sbx_test",
        expect.objectContaining({
          metadata: expect.objectContaining({
            env: JSON.stringify({ EXISTING: "old", NEW: "val" }),
          }),
        }),
      )
    })

    it("throws when no variables provided", async () => {
      const fn = handlers.get("env::set")!
      await expect(fn({ id: "sbx_test", vars: {} })).rejects.toThrow("No variables provided")
    })

    it("throws for non-existent sandbox", async () => {
      const fn = handlers.get("env::set")!
      await expect(fn({ id: "sbx_missing", vars: { A: "1" } })).rejects.toThrow("Sandbox not found")
    })
  })

  describe("env::list", () => {
    it("parses env output into key-value pairs", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "HOME=/root\nPATH=/usr/bin\nLANG=en_US.UTF-8\n",
        stderr: "",
        duration: 10,
      })

      const fn = handlers.get("env::list")!
      const result = await fn({ id: "sbx_test" })

      expect(result.vars).toEqual({
        HOME: "/root",
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
      })
      expect(result.count).toBe(3)
    })

    it("handles values containing equals signs", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require\n",
        stderr: "",
        duration: 10,
      })

      const fn = handlers.get("env::list")!
      const result = await fn({ id: "sbx_test" })

      expect(result.vars.DATABASE_URL).toBe("postgres://user:pass@host:5432/db?sslmode=require")
    })

    it("returns empty object for empty env", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 10,
      })

      const fn = handlers.get("env::list")!
      const result = await fn({ id: "sbx_test" })

      expect(result.vars).toEqual({})
      expect(result.count).toBe(0)
    })

    it("throws when env command fails", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "permission denied",
        duration: 10,
      })

      const fn = handlers.get("env::list")!
      await expect(fn({ id: "sbx_test" })).rejects.toThrow("Failed to list env")
    })
  })

  describe("env::delete", () => {
    it("removes a variable and returns its key", async () => {
      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: { env: JSON.stringify({ A: "1", B: "2" }) },
      })

      const fn = handlers.get("env::delete")!
      const result = await fn({ id: "sbx_test", key: "A" })

      expect(result).toEqual({ deleted: "A" })
    })

    it("updates metadata to remove deleted key", async () => {
      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: { env: JSON.stringify({ A: "1", B: "2" }) },
      })

      const fn = handlers.get("env::delete")!
      await fn({ id: "sbx_test", key: "A" })

      expect(kv.set).toHaveBeenCalledWith(
        "sandbox",
        "sbx_test",
        expect.objectContaining({
          metadata: expect.objectContaining({
            env: JSON.stringify({ B: "2" }),
          }),
        }),
      )
    })

    it("handles delete when no env metadata exists", async () => {
      const fn = handlers.get("env::delete")!
      const result = await fn({ id: "sbx_test", key: "NOPE" })

      expect(result).toEqual({ deleted: "NOPE" })
      expect(kv.set).not.toHaveBeenCalled()
    })

    it("calls sed to remove from /etc/environment", async () => {
      const fn = handlers.get("env::delete")!
      await fn({ id: "sbx_test", key: "MY_KEY" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["sh", "-c", "sed -i '/^MY_KEY=/d' /etc/environment"],
        10000,
      )
    })
  })
})
