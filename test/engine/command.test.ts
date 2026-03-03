import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", async (importOriginal) => {
  const original = await importOriginal() as any
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  }
})

const mockExecInContainer = vi.fn()
const mockExecStreamInContainer = vi.fn()
const mockGetDocker = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  execStreamInContainer: (...args: any[]) => mockExecStreamInContainer(...args),
  getDocker: () => mockGetDocker(),
}))

import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("Command Functions", () => {
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
      stdout: "output",
      stderr: "",
      duration: 50,
    })

    mockExecStreamInContainer.mockImplementation(
      async (_container: any, _cmd: any, _timeout: any, onChunk: Function) => {
        onChunk({ type: "stdout", data: "output\n", timestamp: 1000 })
        onChunk({ type: "exit", data: "0", timestamp: 1001 })
      },
    )

    registerCommandFunctions(sdk, kv as any, config)
  })

  describe("cmd::run", () => {
    it("executes a simple command", async () => {
      const run = handlers.get("cmd::run")!
      const result = await run({ id: "sbx_test", command: "echo hello" })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("output")
    })

    it("passes validated command to exec", async () => {
      const run = handlers.get("cmd::run")!
      await run({ id: "sbx_test", command: "ls -la" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(["sh", "-c"]),
        expect.any(Number),
      )
    })

    it("respects custom timeout", async () => {
      const run = handlers.get("cmd::run")!
      await run({ id: "sbx_test", command: "echo hello", timeout: 10 })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        10000,
      )
    })

    it("caps timeout at maxCommandTimeout", async () => {
      const run = handlers.get("cmd::run")!
      await run({ id: "sbx_test", command: "echo hello", timeout: 9999 })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
      )
    })

    it("uses maxCommandTimeout as default", async () => {
      const run = handlers.get("cmd::run")!
      await run({ id: "sbx_test", command: "echo hello" })

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
      )
    })

    it("throws for non-existent sandbox", async () => {
      const run = handlers.get("cmd::run")!
      await expect(run({ id: "sbx_missing", command: "ls" })).rejects.toThrow("Sandbox not found")
    })

    it("throws for non-running sandbox", async () => {
      kvStore.set("sbx_paused", { ...runningSandbox, id: "sbx_paused", status: "paused" })
      const run = handlers.get("cmd::run")!
      await expect(run({ id: "sbx_paused", command: "ls" })).rejects.toThrow("not running")
    })

    it("supports cwd option", async () => {
      const run = handlers.get("cmd::run")!
      await run({ id: "sbx_test", command: "ls", cwd: "/workspace/src" })

      expect(mockExecInContainer).toHaveBeenCalled()
    })

    it("rejects cwd outside workspace", async () => {
      const run = handlers.get("cmd::run")!
      await expect(run({ id: "sbx_test", command: "ls", cwd: "/etc" })).rejects.toThrow()
    })
  })

  describe("cmd::run-stream", () => {
    const makeStreamReq = (overrides: any = {}) => {
      const streamWritable = { write: vi.fn() }
      const response = {
        stream: streamWritable,
        sendMessage: vi.fn(),
        close: vi.fn(),
      }
      return {
        req: {
          path_params: { id: "sbx_test" },
          body: { command: "echo hello" },
          headers: {},
          query_params: {},
          method: "POST",
          response,
          ...overrides,
        },
        response,
        streamWritable,
      }
    }

    it("streams SSE chunks for a command", async () => {
      const { req, response, streamWritable } = makeStreamReq()
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":200'),
      )
      expect(streamWritable.write).toHaveBeenCalledTimes(2)
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stdout"'),
      )
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"exit"'),
      )
      expect(response.close).toHaveBeenCalled()
    })

    it("formats output as SSE data lines", async () => {
      const { req, streamWritable } = makeStreamReq()
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      const calls = streamWritable.write.mock.calls
      for (const [data] of calls) {
        expect(data).toMatch(/^data: \{.*\}\n\n$/)
      }
    })

    it("sets Content-Type to text/event-stream", async () => {
      const { req, response } = makeStreamReq()
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      )
    })

    it("uses execStreamInContainer with correct timeout", async () => {
      const { req } = makeStreamReq()
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(mockExecStreamInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(["sh", "-c"]),
        300000,
        expect.any(Function),
      )
    })

    it("respects custom timeout", async () => {
      const { req } = makeStreamReq({ body: { command: "echo hello", timeout: 10 } })
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(mockExecStreamInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        10000,
        expect.any(Function),
      )
    })

    it("returns 404 for non-existent sandbox", async () => {
      const { req, response, streamWritable } = makeStreamReq({ path_params: { id: "sbx_missing" } })
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":404'),
      )
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      )
      expect(response.close).toHaveBeenCalled()
    })

    it("returns 400 for non-running sandbox", async () => {
      kvStore.set("sbx_paused", { ...runningSandbox, id: "sbx_paused", status: "paused" })
      const { req, response, streamWritable } = makeStreamReq({ path_params: { id: "sbx_paused" } })
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":400'),
      )
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("not running"),
      )
    })

    it("returns 400 for invalid command", async () => {
      const { req, response, streamWritable } = makeStreamReq({ body: { command: "" } })
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":400'),
      )
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("command is required"),
      )
    })

    it("closes stream on timeout", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: "partial\n", timestamp: 1000 })
          onChunk({ type: "exit", data: "-1", timestamp: 1001 })
          throw new Error("Command timed out after 300000ms")
        },
      )

      const { req, response, streamWritable } = makeStreamReq()
      const handler = handlers.get("cmd::run-stream")!
      await handler(req)

      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"exit"'),
      )
      expect(response.close).toHaveBeenCalled()
    })

    it("handles auth when authToken is set", async () => {
      const configWithAuth = { ...config, authToken: "secret" }

      const handlersWithAuth = new Map<string, Function>()
      const kv = {
        get: vi.fn(async (_scope: string, key: string) => kvStore.get(key) ?? null),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      }
      const sdkMock = {
        registerFunction: vi.fn((meta: any, handler: Function) => {
          handlersWithAuth.set(meta.id, handler)
        }),
      }
      registerCommandFunctions(sdkMock, kv as any, configWithAuth)

      const { req, response } = makeStreamReq({ headers: {} })
      const handler = handlersWithAuth.get("cmd::run-stream")!
      await handler(req)

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":401'),
      )
      expect(response.close).toHaveBeenCalled()
    })
  })
})
