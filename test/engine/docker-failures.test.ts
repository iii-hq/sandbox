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
const mockGetContainerStats = vi.fn()
const mockCreateContainer = vi.fn()

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

import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js"
import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js"
import { registerFilesystemFunctions } from "../../packages/engine/src/functions/filesystem.js"
import { registerSnapshotFunctions } from "../../packages/engine/src/functions/snapshot.js"
import { registerProcessFunctions } from "../../packages/engine/src/functions/process.js"
import { registerMetricsFunctions } from "../../packages/engine/src/functions/metrics.js"
import { registerNetworkFunctions } from "../../packages/engine/src/functions/network.js"
import { registerVolumeFunctions } from "../../packages/engine/src/functions/volume.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"
import { SCOPES } from "../../packages/engine/src/state/schema.js"

describe("Docker Failure Injection", () => {
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
  }

  const runningSandbox = {
    id: "sbx_test",
    name: "test",
    image: "python:3.12-slim",
    status: "running" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: { image: "python:3.12-slim", memory: 512, cpu: 1 },
    metadata: {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
    kvStore = new Map()
    handlers = new Map()

    kv = {
      get: vi.fn(
        async (scope: string, key: string) =>
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

    mockGetDocker.mockReturnValue({
      getContainer: () => ({
        id: "container-1",
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue(undefined),
        unpause: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue({ Id: "sha256:abc123" }),
        top: vi.fn().mockResolvedValue({ Titles: [], Processes: [] }),
      }),
      getImage: () => ({
        inspect: vi.fn().mockResolvedValue({ Size: 104857600 }),
        remove: vi.fn().mockResolvedValue(undefined),
      }),
      createNetwork: vi.fn().mockResolvedValue({
        inspect: vi.fn().mockResolvedValue({ Id: "docker-net-abc" }),
      }),
      getNetwork: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      }),
      createVolume: vi.fn().mockResolvedValue({}),
      getVolume: () => ({
        remove: vi.fn().mockResolvedValue(undefined),
      }),
    })

    mockCreateContainer.mockResolvedValue({})
    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 50,
    })
    mockExecStreamInContainer.mockImplementation(
      async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
        onChunk({ type: "stdout", data: "output\n", timestamp: 1000 })
        onChunk({ type: "exit", data: "0", timestamp: 1001 })
      },
    )
    mockGetContainerStats.mockResolvedValue({
      sandboxId: "sbx_test",
      cpuPercent: 5.2,
      memoryUsageMb: 128,
      memoryLimitMb: 512,
      networkRxBytes: 0,
      networkTxBytes: 0,
      pids: 3,
    })

    registerSandboxFunctions(sdk, kv as any, config)
    registerCommandFunctions(sdk, kv as any, config)
    registerFilesystemFunctions(sdk, kv as any, config)
    registerSnapshotFunctions(sdk, kv as any, config)
    registerProcessFunctions(sdk, kv as any, config)
    registerMetricsFunctions(sdk, kv as any)
    registerNetworkFunctions(sdk, kv as any, config)
    registerVolumeFunctions(sdk, kv as any, config)
  })

  describe("Docker daemon unavailable", () => {
    it("sandbox creation fails when Docker daemon is unreachable", async () => {
      mockCreateContainer.mockRejectedValue(
        new Error("Cannot connect to Docker daemon"),
      )

      const create = handlers.get("sandbox::create")!
      await expect(create({ image: "python:3.12-slim" })).rejects.toThrow(
        "Cannot connect to Docker daemon",
      )
    })

    it("command exec fails when Docker daemon is unreachable", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockGetDocker.mockImplementation(() => {
        throw new Error("Cannot connect to Docker daemon")
      })

      const run = handlers.get("cmd::run")!
      await expect(run({ id: "sbx_test", command: "ls" })).rejects.toThrow(
        "Cannot connect to Docker daemon",
      )
    })

    it("sandbox pause fails when Docker daemon is unreachable", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockGetDocker.mockImplementation(() => {
        throw new Error("Cannot connect to Docker daemon")
      })

      const pause = handlers.get("sandbox::pause")!
      await expect(pause({ id: "sbx_test" })).rejects.toThrow()
    })
  })

  describe("Container not found", () => {
    it("sandbox get-container inspect throws 404", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      const inspectError = new Error("No such container") as any
      inspectError.statusCode = 404
      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          inspect: vi.fn().mockRejectedValue(inspectError),
          top: vi.fn().mockRejectedValue(inspectError),
        }),
      })

      const procList = handlers.get("proc::list")!
      await expect(procList({ id: "sbx_test" })).rejects.toThrow()
    })

    it("metrics fails when container vanished", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockGetContainerStats.mockRejectedValue(
        new Error("No such container: iii-sbx-sbx_test"),
      )

      const metrics = handlers.get("metrics::sandbox")!
      await expect(metrics({ id: "sbx_test" })).rejects.toThrow(
        "No such container",
      )
    })
  })

  describe("Container start failure", () => {
    it("sandbox creation fails when container.start() throws", async () => {
      mockCreateContainer.mockRejectedValue(
        new Error("OCI runtime create failed"),
      )

      const create = handlers.get("sandbox::create")!
      await expect(create({ image: "python:3.12-slim" })).rejects.toThrow(
        "OCI runtime create failed",
      )

      const sandboxes = await kv.list(SCOPES.SANDBOXES)
      expect(sandboxes).toHaveLength(0)
    })
  })

  describe("Exec start failure", () => {
    it("command fails with error propagated from exec", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockExecInContainer.mockRejectedValue(new Error("exec create failed"))

      const run = handlers.get("cmd::run")!
      await expect(run({ id: "sbx_test", command: "echo hello" })).rejects.toThrow(
        "exec create failed",
      )
    })

    it("filesystem read fails when exec throws", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockExecInContainer.mockRejectedValue(new Error("exec create failed"))

      const read = handlers.get("fs::read")!
      await expect(
        read({ id: "sbx_test", path: "/workspace/test.txt" }),
      ).rejects.toThrow()
    })
  })

  describe("OOM kill simulation", () => {
    it("exit code 137 indicates OOM kill", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockExecInContainer.mockResolvedValue({
        exitCode: 137,
        stdout: "",
        stderr: "Killed",
        duration: 5000,
      })

      const run = handlers.get("cmd::run")!
      const result = await run({ id: "sbx_test", command: "stress --vm 1 --vm-bytes 2G" })

      expect(result.exitCode).toBe(137)
      expect(result.stderr).toBe("Killed")
    })

    it("exit code 137 propagated through proc::top", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockExecInContainer.mockResolvedValue({
        exitCode: 137,
        stdout: "",
        stderr: "Killed",
        duration: 100,
      })

      const top = handlers.get("proc::top")!
      const result = await top({ id: "sbx_test" })
      expect(result.processes).toEqual([])
    })
  })

  describe("Container stats timeout", () => {
    it("metrics endpoint handles stats timeout gracefully", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockGetContainerStats.mockRejectedValue(new Error("Stats timeout"))

      const metrics = handlers.get("metrics::sandbox")!
      await expect(metrics({ id: "sbx_test" })).rejects.toThrow("Stats timeout")
    })
  })

  describe("Image commit failure (snapshot)", () => {
    it("snapshot creation fails when commit throws no space", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      const mockCommit = vi.fn().mockRejectedValue(
        new Error("No space left on device"),
      )
      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          id: "container-1",
          commit: mockCommit,
        }),
        getImage: () => ({
          inspect: vi.fn().mockResolvedValue({ Size: 0 }),
        }),
      })

      const create = handlers.get("snapshot::create")!
      await expect(
        create({ id: "sbx_test", name: "my-snap" }),
      ).rejects.toThrow("No space left on device")

      const snapshots = await kv.list(SCOPES.SNAPSHOTS)
      expect(snapshots).toHaveLength(0)
    })

    it("snapshot creation fails when image inspect throws after commit", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          id: "container-1",
          commit: vi.fn().mockResolvedValue({ Id: "sha256:partial" }),
        }),
        getImage: () => ({
          inspect: vi.fn().mockRejectedValue(new Error("Image corrupted")),
        }),
      })

      const create = handlers.get("snapshot::create")!
      await expect(
        create({ id: "sbx_test", name: "bad-snap" }),
      ).rejects.toThrow("Image corrupted")

      const snapshots = await kv.list(SCOPES.SNAPSHOTS)
      expect(snapshots).toHaveLength(0)
    })
  })

  describe("Container stop failure during kill", () => {
    it("sandbox kill succeeds even when container.stop() throws", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      const mockRemove = vi.fn().mockResolvedValue(undefined)
      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          stop: vi.fn().mockRejectedValue(new Error("container already stopped")),
          remove: mockRemove,
        }),
      })

      const kill = handlers.get("sandbox::kill")!
      const result = await kill({ id: "sbx_test" })

      expect(result.success).toBe(true)
      expect(mockRemove).toHaveBeenCalledWith({ force: true })
    })

    it("sandbox is removed from KV after kill despite stop failure", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          stop: vi.fn().mockRejectedValue(new Error("container already stopped")),
          remove: vi.fn().mockResolvedValue(undefined),
        }),
      })

      const kill = handlers.get("sandbox::kill")!
      await kill({ id: "sbx_test" })

      const sandbox = await kv.get(SCOPES.SANDBOXES, "sbx_test")
      expect(sandbox).toBeNull()
    })
  })

  describe("Container already removed during cleanup", () => {
    it("sandbox kill succeeds when remove throws 404", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      const notFoundError = new Error("No such container") as any
      notFoundError.statusCode = 404
      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          stop: vi.fn().mockRejectedValue(notFoundError),
          remove: vi.fn().mockRejectedValue(notFoundError),
        }),
      })

      const kill = handlers.get("sandbox::kill")!
      const result = await kill({ id: "sbx_test" })

      expect(result.success).toBe(true)

      const sandbox = await kv.get(SCOPES.SANDBOXES, "sbx_test")
      expect(sandbox).toBeNull()
    })
  })

  describe("Exec timeout produces partial output", () => {
    it("captures partial stdout before timeout error", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockExecInContainer.mockResolvedValue({
        exitCode: -1,
        stdout: "partial output before timeout",
        stderr: "",
        duration: 300000,
      })

      const run = handlers.get("cmd::run")!
      const result = await run({ id: "sbx_test", command: "long-running" })

      expect(result.stdout).toBe("partial output before timeout")
      expect(result.exitCode).toBe(-1)
    })
  })

  describe("Docker network create failure", () => {
    it("network creation fails and propagates error", async () => {
      mockGetDocker.mockReturnValue({
        createNetwork: vi.fn().mockRejectedValue(
          new Error("network pool overlapping"),
        ),
        getNetwork: () => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          remove: vi.fn(),
        }),
      })

      const create = handlers.get("network::create")!
      await expect(create({ name: "bad-net" })).rejects.toThrow(
        "network pool overlapping",
      )

      const networks = await kv.list(SCOPES.NETWORKS)
      expect(networks).toHaveLength(0)
    })

    it("network delete fails when docker remove throws", async () => {
      const mockNetRemove = vi.fn().mockRejectedValue(new Error("network in use"))
      mockGetDocker.mockReturnValue({
        createNetwork: vi.fn().mockResolvedValue({
          inspect: vi.fn().mockResolvedValue({ Id: "net-123" }),
        }),
        getNetwork: () => ({
          connect: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
          remove: mockNetRemove,
        }),
      })

      const create = handlers.get("network::create")!
      const net = await create({ name: "stuck-net" })

      const del = handlers.get("network::delete")!
      await expect(del({ networkId: net.id })).rejects.toThrow("network in use")
    })
  })

  describe("Volume mount failure", () => {
    it("volume creation fails when docker createVolume throws", async () => {
      mockGetDocker.mockReturnValue({
        createVolume: vi.fn().mockRejectedValue(
          new Error("volume driver not found"),
        ),
        getVolume: () => ({
          remove: vi.fn(),
        }),
      })

      const create = handlers.get("volume::create")!
      await expect(
        create({ name: "bad-vol", driver: "nonexistent" }),
      ).rejects.toThrow("volume driver not found")

      const volumes = await kv.list(SCOPES.VOLUMES)
      expect(volumes).toHaveLength(0)
    })
  })

  describe("Process list failure", () => {
    it("proc::list fails when container.top() throws not running", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          id: "container-1",
          top: vi.fn().mockRejectedValue(new Error("Container is not running")),
        }),
      })

      const list = handlers.get("proc::list")!
      await expect(list({ id: "sbx_test" })).rejects.toThrow(
        "Container is not running",
      )
    })

    it("proc::kill fails when exec throws inside container", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockExecInContainer.mockRejectedValue(
        new Error("Container is not running"),
      )

      const kill = handlers.get("proc::kill")!
      await expect(
        kill({ id: "sbx_test", pid: 42 }),
      ).rejects.toThrow("Container is not running")
    })
  })

  describe("Stream exec failure mid-stream", () => {
    it("delivers partial chunks before stream error", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      const collectedChunks: any[] = []
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: "line1\n", timestamp: 1000 })
          onChunk({ type: "stdout", data: "line2\n", timestamp: 1001 })
          throw new Error("stream connection reset")
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

      const handler = handlers.get("cmd::run-stream")!
      await handler({
        path_params: { id: "sbx_test" },
        body: { command: "tail -f /var/log/syslog" },
        headers: {},
        query_params: {},
        method: "POST",
        response,
      })

      const writes = streamWritable.write.mock.calls
      const stdoutWrites = writes.filter(([data]: [string]) =>
        data.includes('"type":"stdout"'),
      )
      expect(stdoutWrites.length).toBe(2)
      expect(response.close).toHaveBeenCalled()
    })
  })

  describe("Concurrent Docker failures", () => {
    it("multiple simultaneous command failures do not cause unhandled rejections", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockExecInContainer
        .mockRejectedValueOnce(new Error("exec failed 1"))
        .mockRejectedValueOnce(new Error("exec failed 2"))
        .mockRejectedValueOnce(new Error("exec failed 3"))

      const run = handlers.get("cmd::run")!
      const results = await Promise.allSettled([
        run({ id: "sbx_test", command: "cmd1" }),
        run({ id: "sbx_test", command: "cmd2" }),
        run({ id: "sbx_test", command: "cmd3" }),
      ])

      expect(results.every((r) => r.status === "rejected")).toBe(true)
      expect((results[0] as PromiseRejectedResult).reason.message).toBe("exec failed 1")
      expect((results[1] as PromiseRejectedResult).reason.message).toBe("exec failed 2")
      expect((results[2] as PromiseRejectedResult).reason.message).toBe("exec failed 3")
    })

    it("concurrent sandbox kill operations with Docker errors all succeed", async () => {
      const sandboxes = ["sbx_a", "sbx_b", "sbx_c"]
      for (const id of sandboxes) {
        kvStore.set(SCOPES.SANDBOXES, new Map([
          ...(kvStore.get(SCOPES.SANDBOXES) ?? new Map()),
          [id, { ...runningSandbox, id }],
        ]))
      }

      let callCount = 0
      mockGetDocker.mockImplementation(() => ({
        getContainer: () => {
          callCount++
          if (callCount === 1) {
            return {
              stop: vi.fn().mockRejectedValue(new Error("already stopped")),
              remove: vi.fn().mockResolvedValue(undefined),
            }
          }
          if (callCount === 2) {
            return {
              stop: vi.fn().mockResolvedValue(undefined),
              remove: vi.fn().mockRejectedValue(new Error("No such container")),
            }
          }
          return {
            stop: vi.fn().mockRejectedValue(new Error("timeout")),
            remove: vi.fn().mockRejectedValue(new Error("No such container")),
          }
        },
      }))

      const kill = handlers.get("sandbox::kill")!
      const results = await Promise.allSettled(
        sandboxes.map((id) => kill({ id })),
      )

      for (const result of results) {
        expect(result.status).toBe("fulfilled")
        expect((result as PromiseFulfilledResult<any>).value.success).toBe(true)
      }
    })

    it("simultaneous metrics and command failures are independent", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockGetContainerStats.mockRejectedValue(new Error("Stats timeout"))
      mockExecInContainer.mockRejectedValue(new Error("exec failed"))

      const metrics = handlers.get("metrics::sandbox")!
      const run = handlers.get("cmd::run")!

      const results = await Promise.allSettled([
        metrics({ id: "sbx_test" }),
        run({ id: "sbx_test", command: "echo hi" }),
      ])

      expect(results[0].status).toBe("rejected")
      expect(results[1].status).toBe("rejected")
      expect((results[0] as PromiseRejectedResult).reason.message).toBe("Stats timeout")
      expect((results[1] as PromiseRejectedResult).reason.message).toBe("exec failed")
    })
  })

  describe("Snapshot restore failure", () => {
    it("restore fails when old container removal throws and propagates", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      const snapshot = {
        id: "snap_abc",
        sandboxId: "sbx_test",
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      }
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          stop: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockRejectedValue(new Error("Device or resource busy")),
        }),
      })

      const restore = handlers.get("snapshot::restore")!
      await expect(
        restore({ id: "sbx_test", snapshotId: "snap_abc" }),
      ).rejects.toThrow("Device or resource busy")
    })

    it("restore fails when createContainer throws after old removal", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      const snapshot = {
        id: "snap_abc",
        sandboxId: "sbx_test",
        name: "test-snap",
        imageId: "sha256:abc123",
        size: 104857600,
        createdAt: Date.now(),
      }
      kvStore.set(SCOPES.SNAPSHOTS, new Map([[snapshot.id, snapshot]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          stop: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        }),
      })
      mockCreateContainer.mockRejectedValue(new Error("Image not found locally"))

      const restore = handlers.get("snapshot::restore")!
      await expect(
        restore({ id: "sbx_test", snapshotId: "snap_abc" }),
      ).rejects.toThrow("Image not found locally")
    })
  })

  describe("Sandbox pause/resume Docker failures", () => {
    it("pause fails when container.pause() throws", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          pause: vi.fn().mockRejectedValue(new Error("Cannot pause: cgroups error")),
        }),
      })

      const pause = handlers.get("sandbox::pause")!
      await expect(pause({ id: "sbx_test" })).rejects.toThrow("Failed to pause sandbox")

      const sandbox = await kv.get(SCOPES.SANDBOXES, "sbx_test")
      expect(sandbox.status).toBe("running")
    })

    it("resume fails when container.unpause() throws", async () => {
      const pausedSandbox = { ...runningSandbox, status: "paused" as const }
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", pausedSandbox]]))

      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          unpause: vi.fn().mockRejectedValue(new Error("Cannot unpause: not paused")),
        }),
      })

      const resume = handlers.get("sandbox::resume")!
      await expect(resume({ id: "sbx_test" })).rejects.toThrow("Failed to resume sandbox")

      const sandbox = await kv.get(SCOPES.SANDBOXES, "sbx_test")
      expect(sandbox.status).toBe("paused")
    })
  })

  describe("Filesystem Docker failures", () => {
    it("fs::delete fails when exec returns permission denied", async () => {
      kvStore.set(SCOPES.SANDBOXES, new Map([["sbx_test", runningSandbox]]))
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "rm: cannot remove: Operation not permitted",
        duration: 10,
      })

      const del = handlers.get("fs::delete")!
      await expect(
        del({ id: "sbx_test", path: "/workspace/protected.txt" }),
      ).rejects.toThrow("Failed to delete")
    })
  })
})
