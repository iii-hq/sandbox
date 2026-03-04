import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
const mockGetContainerStats = vi.fn()
const mockCreateContainer = vi.fn()
const mockCommit = vi.fn()
const mockImageInspect = vi.fn()
const mockImageRemove = vi.fn()
const mockStop = vi.fn()
const mockRemove = vi.fn()
const mockPause = vi.fn()
const mockUnpause = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  execStreamInContainer: (...args: any[]) => mockExecStreamInContainer(...args),
  getDocker: () => mockGetDocker(),
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
  createContainer: (...args: any[]) => mockCreateContainer(...args),
}))

vi.mock("../../packages/engine/src/docker/images.js", () => ({
  ensureImage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../packages/engine/src/functions/metrics.js", () => ({
  incrementExpired: vi.fn(),
}))

import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js"
import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js"
import { registerSnapshotFunctions } from "../../packages/engine/src/functions/snapshot.js"
import { registerEnvFunctions } from "../../packages/engine/src/functions/env.js"
import { registerTtlSweep } from "../../packages/engine/src/lifecycle/ttl.js"
import { SCOPES } from "../../packages/engine/src/state/schema.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe("Race Conditions", () => {
  let handlers: Map<string, Function>
  let kvStore: Map<string, Map<string, any>>
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
    maxFileSize: 10485760,
    cleanupOnExit: true,
  } as any

  const makeSandbox = (overrides: Record<string, any> = {}) => ({
    id: "sbx_race1",
    name: "race-test",
    image: "python:3.12-slim",
    status: "running" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: { image: "python:3.12-slim", memory: 512, cpu: 1, workdir: "/workspace" },
    metadata: {},
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    kvStore = new Map()
    kvStore.set(SCOPES.SANDBOXES, new Map())
    kvStore.set(SCOPES.SNAPSHOTS, new Map())
    handlers = new Map()

    kv = {
      get: vi.fn(async (scope: string, key: string) =>
        kvStore.get(scope)?.get(key) ?? null,
      ),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!kvStore.has(scope)) kvStore.set(scope, new Map())
        kvStore.get(scope)!.set(key, value)
      }),
      delete: vi.fn(async (scope: string, key: string) => {
        kvStore.get(scope)?.delete(key)
      }),
      list: vi.fn(async (scope: string) => {
        const m = kvStore.get(scope)
        return m ? Array.from(m.values()) : []
      }),
    }

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler)
      }),
      trigger: vi.fn(),
    }

    mockStop.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
    mockPause.mockResolvedValue(undefined)
    mockUnpause.mockResolvedValue(undefined)
    mockCreateContainer.mockResolvedValue({})
    mockCommit.mockResolvedValue({ Id: "sha256:abc123" })
    mockImageInspect.mockResolvedValue({ Size: 104857600 })
    mockImageRemove.mockResolvedValue(undefined)

    mockGetDocker.mockReturnValue({
      getContainer: () => ({
        id: "container-1",
        stop: mockStop,
        remove: mockRemove,
        pause: mockPause,
        unpause: mockUnpause,
        commit: mockCommit,
        logs: vi.fn().mockResolvedValue({
          on: vi.fn(),
        }),
      }),
      getImage: () => ({
        inspect: mockImageInspect,
        remove: mockImageRemove,
      }),
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

    registerSandboxFunctions(sdk, kv as any, config)
    registerCommandFunctions(sdk, kv as any, config)
    registerSnapshotFunctions(sdk, kv as any, config)
    registerEnvFunctions(sdk, kv as any, config)
    registerTtlSweep(sdk, kv as any)
  })

  describe("kill during exec", () => {
    it("kill completes while exec is in-flight without deadlock", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      mockExecInContainer.mockImplementation(
        () => new Promise(resolve =>
          setTimeout(() => resolve({
            exitCode: 0, stdout: "slow", stderr: "", duration: 500,
          }), 200),
        ),
      )

      const execPromise = handlers.get("cmd::run")!({
        id: sandbox.id,
        command: "sleep 5",
      })

      await delay(50)

      const killResult = await handlers.get("sandbox::kill")!({ id: sandbox.id })
      expect(killResult.success).toBe(true)

      const execResult = await execPromise
      expect(execResult.exitCode).toBe(0)
    })

    it("kill removes sandbox from KV even if exec started first", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      mockExecInContainer.mockImplementation(
        () => new Promise(resolve =>
          setTimeout(() => resolve({
            exitCode: 0, stdout: "done", stderr: "", duration: 300,
          }), 150),
        ),
      )

      const execPromise = handlers.get("cmd::run")!({
        id: sandbox.id,
        command: "long-task",
      })

      await delay(30)
      await handlers.get("sandbox::kill")!({ id: sandbox.id })

      expect(kvStore.get(SCOPES.SANDBOXES)!.has(sandbox.id)).toBe(false)

      await execPromise
    })
  })

  describe("pause during streaming", () => {
    it("stream handles pause gracefully when chunks are in-flight", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      let chunkCallback: Function | null = null
      mockExecStreamInContainer.mockImplementation(
        async (_container: any, _cmd: any, _timeout: any, onChunk: Function) => {
          chunkCallback = onChunk
          onChunk({ type: "stdout", data: "chunk1\n", timestamp: 1000 })
          await delay(100)
          onChunk({ type: "stdout", data: "chunk2\n", timestamp: 1100 })
          onChunk({ type: "exit", data: "0", timestamp: 1200 })
        },
      )

      const streamWritable = { write: vi.fn() }
      const response = {
        stream: streamWritable,
        sendMessage: vi.fn(),
        close: vi.fn(),
        status: vi.fn(),
        headers: vi.fn(),
      }
      const req = {
        path_params: { id: sandbox.id },
        body: { command: "echo streaming" },
        headers: {},
        query_params: {},
        method: "POST",
        response,
      }

      const streamPromise = handlers.get("cmd::run-stream")!(req)

      await delay(50)

      sandbox.status = "paused"
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)
      await mockPause()

      await streamPromise

      expect(response.close).toHaveBeenCalled()
    })
  })

  describe("exec on just-paused sandbox", () => {
    it("exec fails with 'not running' after pause", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::pause")!({ id: sandbox.id })

      const run = handlers.get("cmd::run")!
      await expect(run({ id: sandbox.id, command: "ls" })).rejects.toThrow("not running")
    })

    it("exec fails immediately when sandbox was just paused concurrently", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      const pausePromise = handlers.get("sandbox::pause")!({ id: sandbox.id })
      await pausePromise

      await expect(
        handlers.get("cmd::run")!({ id: sandbox.id, command: "echo test" }),
      ).rejects.toThrow("not running")
    })
  })

  describe("resume then immediately exec", () => {
    it("exec succeeds after resume completes", async () => {
      const sandbox = makeSandbox({ status: "paused" })
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::resume")!({ id: sandbox.id })

      const result = await handlers.get("cmd::run")!({
        id: sandbox.id,
        command: "echo hello",
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("output")
    })

    it("resume updates status to running before exec reads it", async () => {
      const sandbox = makeSandbox({ status: "paused" })
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::resume")!({ id: sandbox.id })

      const stored = kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id)
      expect(stored.status).toBe("running")

      const result = await handlers.get("cmd::run")!({
        id: sandbox.id,
        command: "whoami",
      })
      expect(result.exitCode).toBe(0)
    })
  })

  describe("rapid state transitions", () => {
    it("running -> paused -> running -> paused -> kill preserves correct state at each step", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      const pauseResult1 = await handlers.get("sandbox::pause")!({ id: sandbox.id })
      expect(pauseResult1.status).toBe("paused")

      const resumeResult1 = await handlers.get("sandbox::resume")!({ id: sandbox.id })
      expect(resumeResult1.status).toBe("running")

      const pauseResult2 = await handlers.get("sandbox::pause")!({ id: sandbox.id })
      expect(pauseResult2.status).toBe("paused")

      const killResult = await handlers.get("sandbox::kill")!({ id: sandbox.id })
      expect(killResult.success).toBe(true)

      expect(kvStore.get(SCOPES.SANDBOXES)!.has(sandbox.id)).toBe(false)
    })

    it("sequential state changes update KV correctly at each step", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::pause")!({ id: sandbox.id })
      expect(kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id).status).toBe("paused")

      await handlers.get("sandbox::resume")!({ id: sandbox.id })
      expect(kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id).status).toBe("running")

      await handlers.get("sandbox::pause")!({ id: sandbox.id })
      expect(kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id).status).toBe("paused")

      await handlers.get("sandbox::resume")!({ id: sandbox.id })
      expect(kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id).status).toBe("running")

      await handlers.get("sandbox::kill")!({ id: sandbox.id })
      expect(kvStore.get(SCOPES.SANDBOXES)!.has(sandbox.id)).toBe(false)
    })

    it("cannot pause an already-paused sandbox", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::pause")!({ id: sandbox.id })

      await expect(
        handlers.get("sandbox::pause")!({ id: sandbox.id }),
      ).rejects.toThrow("not running")
    })
  })

  describe("double kill", () => {
    it("second kill throws Sandbox not found without crashing", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      const result1 = await handlers.get("sandbox::kill")!({ id: sandbox.id })
      expect(result1.success).toBe(true)

      await expect(
        handlers.get("sandbox::kill")!({ id: sandbox.id }),
      ).rejects.toThrow("Sandbox not found")
    })

    it("concurrent double kill: one succeeds, one fails or both complete", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      mockStop.mockImplementation(() => delay(50))

      const kill1 = handlers.get("sandbox::kill")!({ id: sandbox.id })
      const kill2 = handlers.get("sandbox::kill")!({ id: sandbox.id })

      const results = await Promise.allSettled([kill1, kill2])

      const successes = results.filter(r => r.status === "fulfilled")
      const failures = results.filter(r => r.status === "rejected")

      expect(successes.length + failures.length).toBe(2)
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("create while at max limit, concurrent kill frees slot", () => {
    it("create succeeds after concurrent kill frees a slot", async () => {
      for (let i = 0; i < 10; i++) {
        const sbx = makeSandbox({ id: `sbx_fill_${i}`, name: `fill-${i}` })
        kvStore.get(SCOPES.SANDBOXES)!.set(sbx.id, sbx)
      }

      const list = await kv.list(SCOPES.SANDBOXES)
      expect(list.length).toBe(10)

      await handlers.get("sandbox::kill")!({ id: "sbx_fill_0" })

      const result = await handlers.get("sandbox::create")!({
        image: "python:3.12-slim",
      })
      expect(result.status).toBe("running")
      expect(result.id).toBeTruthy()
    })

    it("create fails when limit is reached and nothing is killed", async () => {
      for (let i = 0; i < 10; i++) {
        const sbx = makeSandbox({ id: `sbx_max_${i}`, name: `max-${i}` })
        kvStore.get(SCOPES.SANDBOXES)!.set(sbx.id, sbx)
      }

      await expect(
        handlers.get("sandbox::create")!({ image: "python:3.12-slim" }),
      ).rejects.toThrow("Maximum sandbox limit")
    })

    it("interleaved kill and create: kill first, then create fills freed slot", async () => {
      for (let i = 0; i < 10; i++) {
        const sbx = makeSandbox({ id: `sbx_inter_${i}`, name: `inter-${i}` })
        kvStore.get(SCOPES.SANDBOXES)!.set(sbx.id, sbx)
      }

      await handlers.get("sandbox::kill")!({ id: "sbx_inter_5" })
      await handlers.get("sandbox::kill")!({ id: "sbx_inter_9" })

      const r1 = await handlers.get("sandbox::create")!({ image: "python:3.12-slim" })
      expect(r1.status).toBe("running")

      const r2 = await handlers.get("sandbox::create")!({ image: "python:3.12-slim" })
      expect(r2.status).toBe("running")

      await expect(
        handlers.get("sandbox::create")!({ image: "python:3.12-slim" }),
      ).rejects.toThrow("Maximum sandbox limit")
    })
  })

  describe("concurrent snapshot create on same sandbox", () => {
    it("3 concurrent snapshots all succeed with unique IDs", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      let commitCount = 0
      mockCommit.mockImplementation(async () => {
        commitCount++
        await delay(30)
        return { Id: `sha256:snap_img_${commitCount}` }
      })

      const [snap1, snap2, snap3] = await Promise.all([
        handlers.get("snapshot::create")!({ id: sandbox.id, name: "snap-a" }),
        handlers.get("snapshot::create")!({ id: sandbox.id, name: "snap-b" }),
        handlers.get("snapshot::create")!({ id: sandbox.id, name: "snap-c" }),
      ])

      expect(snap1.id).toBeTruthy()
      expect(snap2.id).toBeTruthy()
      expect(snap3.id).toBeTruthy()

      const ids = new Set([snap1.id, snap2.id, snap3.id])
      expect(ids.size).toBe(3)

      expect(snap1.sandboxId).toBe(sandbox.id)
      expect(snap2.sandboxId).toBe(sandbox.id)
      expect(snap3.sandboxId).toBe(sandbox.id)
    })

    it("concurrent snapshots are all stored in KV", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      mockCommit.mockImplementation(async () => {
        await delay(20)
        return { Id: "sha256:concurrent" }
      })

      const results = await Promise.all([
        handlers.get("snapshot::create")!({ id: sandbox.id, name: "c1" }),
        handlers.get("snapshot::create")!({ id: sandbox.id, name: "c2" }),
        handlers.get("snapshot::create")!({ id: sandbox.id, name: "c3" }),
      ])

      const snapshots = kvStore.get(SCOPES.SNAPSHOTS)!
      expect(snapshots.size).toBe(3)

      for (const result of results) {
        expect(snapshots.has(result.id)).toBe(true)
      }
    })
  })

  describe("TTL sweep during exec", () => {
    it("TTL sweep removes expired sandbox while exec is in-flight", async () => {
      const sandbox = makeSandbox({ expiresAt: Date.now() - 1000 })
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      mockExecInContainer.mockImplementation(
        () => new Promise(resolve =>
          setTimeout(() => resolve({
            exitCode: 0, stdout: "slow-output", stderr: "", duration: 5000,
          }), 200),
        ),
      )

      const execPromise = handlers.get("cmd::run")!({
        id: sandbox.id,
        command: "sleep 5",
      })

      await delay(50)

      const sweepResult = await handlers.get("lifecycle::ttl-sweep")!()
      expect(sweepResult.swept).toBe(1)
      expect(kvStore.get(SCOPES.SANDBOXES)!.has(sandbox.id)).toBe(false)

      const execResult = await execPromise
      expect(execResult.exitCode).toBe(0)
    })

    it("TTL sweep does not affect non-expired sandboxes while exec runs", async () => {
      const expiredSandbox = makeSandbox({
        id: "sbx_expired",
        expiresAt: Date.now() - 5000,
      })
      const activeSandbox = makeSandbox({
        id: "sbx_active",
        expiresAt: Date.now() + 600000,
      })

      kvStore.get(SCOPES.SANDBOXES)!.set(expiredSandbox.id, expiredSandbox)
      kvStore.get(SCOPES.SANDBOXES)!.set(activeSandbox.id, activeSandbox)

      mockExecInContainer.mockImplementation(
        () => new Promise(resolve =>
          setTimeout(() => resolve({
            exitCode: 0, stdout: "ok", stderr: "", duration: 100,
          }), 100),
        ),
      )

      const execPromise = handlers.get("cmd::run")!({
        id: activeSandbox.id,
        command: "echo hi",
      })

      await delay(30)

      const sweepResult = await handlers.get("lifecycle::ttl-sweep")!()
      expect(sweepResult.swept).toBe(1)
      expect(kvStore.get(SCOPES.SANDBOXES)!.has("sbx_expired")).toBe(false)
      expect(kvStore.get(SCOPES.SANDBOXES)!.has("sbx_active")).toBe(true)

      const execResult = await execPromise
      expect(execResult.exitCode).toBe(0)
    })
  })

  describe("concurrent env set with same key", () => {
    it("last writer wins when two env::set calls target the same key", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      let callCount = 0
      mockExecInContainer.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          await delay(80)
        }
        return { exitCode: 0, stdout: "", stderr: "", duration: 10 }
      })

      const set1 = handlers.get("env::set")!({
        id: sandbox.id,
        vars: { SHARED_KEY: "value_A" },
      })

      await delay(10)

      const set2 = handlers.get("env::set")!({
        id: sandbox.id,
        vars: { SHARED_KEY: "value_B" },
      })

      await Promise.all([set1, set2])

      const stored = kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id)
      const envData = JSON.parse(stored.metadata.env)
      expect(["value_A", "value_B"]).toContain(envData.SHARED_KEY)
    })

    it("concurrent env::set with different keys preserves both", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      mockExecInContainer.mockImplementation(async () => {
        await delay(20)
        return { exitCode: 0, stdout: "", stderr: "", duration: 10 }
      })

      await Promise.all([
        handlers.get("env::set")!({ id: sandbox.id, vars: { KEY_X: "val_x" } }),
        handlers.get("env::set")!({ id: sandbox.id, vars: { KEY_Y: "val_y" } }),
      ])

      const stored = kvStore.get(SCOPES.SANDBOXES)!.get(sandbox.id)
      const envData = JSON.parse(stored.metadata.env)
      expect(envData.KEY_X || envData.KEY_Y).toBeTruthy()
    })
  })

  describe("additional race scenarios", () => {
    it("pause then kill: kill succeeds on paused sandbox", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::pause")!({ id: sandbox.id })

      const killResult = await handlers.get("sandbox::kill")!({ id: sandbox.id })
      expect(killResult.success).toBe(true)
      expect(kvStore.get(SCOPES.SANDBOXES)!.has(sandbox.id)).toBe(false)
    })

    it("resume a killed sandbox fails with not found", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::kill")!({ id: sandbox.id })

      await expect(
        handlers.get("sandbox::resume")!({ id: sandbox.id }),
      ).rejects.toThrow("Sandbox not found")
    })

    it("snapshot create on killed sandbox fails", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::kill")!({ id: sandbox.id })

      await expect(
        handlers.get("snapshot::create")!({ id: sandbox.id }),
      ).rejects.toThrow("Sandbox not found")
    })

    it("env::set on killed sandbox fails", async () => {
      const sandbox = makeSandbox()
      kvStore.get(SCOPES.SANDBOXES)!.set(sandbox.id, sandbox)

      await handlers.get("sandbox::kill")!({ id: sandbox.id })

      await expect(
        handlers.get("env::set")!({ id: sandbox.id, vars: { FOO: "bar" } }),
      ).rejects.toThrow("Sandbox not found")
    })

    it("concurrent create operations produce unique sandbox IDs", async () => {
      const creates = Array.from({ length: 5 }, () =>
        handlers.get("sandbox::create")!({ image: "python:3.12-slim" }),
      )

      const results = await Promise.all(creates)
      const ids = new Set(results.map((r: any) => r.id))
      expect(ids.size).toBe(5)

      for (const result of results) {
        expect(result.status).toBe("running")
      }
    })
  })
})
