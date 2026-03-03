import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockContainer, mockExec, mockDockerInstance } = vi.hoisted(() => {
  const mockContainer: any = {
    start: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn(),
    stats: vi.fn(),
    inspect: vi.fn(),
    putArchive: vi.fn().mockResolvedValue(undefined),
    getArchive: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  }

  const mockExec: any = {
    start: vi.fn(),
    inspect: vi.fn(),
  }

  const mockDockerInstance: any = {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getContainer: vi.fn().mockReturnValue(mockContainer),
    modem: { demuxStream: vi.fn(), followProgress: vi.fn() },
  }

  return { mockContainer, mockExec, mockDockerInstance }
})

vi.mock("dockerode", () => ({
  default: vi.fn(() => mockDockerInstance),
}))

import {
  createContainer,
  execInContainer,
  execStreamInContainer,
  getContainerStats,
  listContainerDir,
  searchInContainer,
  execBackground,
} from "../../packages/engine/src/docker/client.js"

describe("Docker Client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContainer.start.mockResolvedValue(undefined)
    mockContainer.putArchive.mockResolvedValue(undefined)
    mockExec.inspect.mockResolvedValue({ ExitCode: 0 })
    mockDockerInstance.createContainer.mockResolvedValue(mockContainer)
  })

  describe("createContainer", () => {
    it("creates with correct options and starts container", async () => {
      const config = {
        image: "python:3.12-slim",
        memory: 512,
        cpu: 1,
        network: false,
        env: { NODE_ENV: "test" },
        workdir: "/workspace",
      }

      const result = await createContainer("test-id", config)

      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: "python:3.12-slim",
          name: "iii-sbx-test-id",
          Hostname: "test-id",
          WorkingDir: "/workspace",
          Env: ["NODE_ENV=test"],
          Cmd: ["tail", "-f", "/dev/null"],
          HostConfig: expect.objectContaining({
            Memory: 512 * 1024 * 1024,
            CpuShares: 1 * 1024,
            NetworkMode: "none",
          }),
        }),
      )
      expect(mockContainer.start).toHaveBeenCalled()
      expect(result).toBe(mockContainer)
    })

    it("handles custom entrypoint", async () => {
      const config = { image: "python:3.12-slim" }
      const entrypoint = ["/bin/bash", "-c", "python server.py"]

      await createContainer("ep-id", config, entrypoint)

      const callArgs = mockDockerInstance.createContainer.mock.calls[0][0]
      expect(callArgs.Entrypoint).toEqual(entrypoint)
      expect(callArgs.Cmd).toBeUndefined()
    })

    it("uses tail command when no entrypoint given", async () => {
      const config = { image: "node:20" }

      await createContainer("no-ep", config)

      const callArgs = mockDockerInstance.createContainer.mock.calls[0][0]
      expect(callArgs.Cmd).toEqual(["tail", "-f", "/dev/null"])
      expect(callArgs.Entrypoint).toBeUndefined()
    })

    it("sets security options", async () => {
      const config = { image: "python:3.12-slim" }

      await createContainer("sec-id", config)

      const callArgs = mockDockerInstance.createContainer.mock.calls[0][0]
      expect(callArgs.HostConfig.SecurityOpt).toEqual(["no-new-privileges"])
      expect(callArgs.HostConfig.CapDrop).toEqual(["NET_RAW", "SYS_ADMIN", "MKNOD"])
      expect(callArgs.HostConfig.PidsLimit).toBe(256)
    })

    it("sets bridge network mode when network is true", async () => {
      const config = { image: "python:3.12-slim", network: true }

      await createContainer("net-id", config)

      const callArgs = mockDockerInstance.createContainer.mock.calls[0][0]
      expect(callArgs.HostConfig.NetworkMode).toBe("bridge")
    })

    it("sets labels for sandbox identification", async () => {
      const config = { image: "python:3.12-slim" }

      await createContainer("lbl-id", config)

      const callArgs = mockDockerInstance.createContainer.mock.calls[0][0]
      expect(callArgs.Labels).toEqual({
        "iii-sandbox": "true",
        "iii-sandbox-id": "lbl-id",
      })
    })
  })

  describe("execInContainer", () => {
    function setupExecMock(stdoutData: string, stderrData: string, exitCode: number) {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()

        mockDockerInstance.modem.demuxStream.mockImplementation(
          (_s: any, stdoutStream: any, stderrStream: any) => {
            if (stdoutData) stdoutStream.write(Buffer.from(stdoutData))
            if (stderrData) stderrStream.write(Buffer.from(stderrData))
            process.nextTick(() => stream.emit("end"))
          },
        )

        cb(null, stream)
      })
      mockExec.inspect.mockResolvedValue({ ExitCode: exitCode })
    }

    it("returns stdout, stderr, and exitCode", async () => {
      setupExecMock("hello world", "warning", 0)

      const result = await execInContainer(mockContainer, ["echo", "hello"], 5000)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("hello world")
      expect(result.stderr).toBe("warning")
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it("handles timeout", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()
        mockDockerInstance.modem.demuxStream.mockImplementation(() => {})
        cb(null, stream)
      })

      await expect(
        execInContainer(mockContainer, ["sleep", "60"], 50),
      ).rejects.toThrow("Command timed out after 50ms")
    })

    it("handles exec start error", async () => {
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        cb(new Error("exec start failed"), null)
      })

      await expect(
        execInContainer(mockContainer, ["bad"], 5000),
      ).rejects.toThrow("exec start failed")
    })

    it("handles no stream", async () => {
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        cb(null, null)
      })

      await expect(
        execInContainer(mockContainer, ["bad"], 5000),
      ).rejects.toThrow("No stream")
    })
  })

  describe("execStreamInContainer", () => {
    it("calls onChunk for stdout, stderr, and exit", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      const chunks: any[] = []

      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()

        mockDockerInstance.modem.demuxStream.mockImplementation(
          (_s: any, stdoutStream: any, stderrStream: any) => {
            stdoutStream.write(Buffer.from("out data"))
            stderrStream.write(Buffer.from("err data"))
            process.nextTick(() => stream.emit("end"))
          },
        )

        cb(null, stream)
      })
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 })

      await execStreamInContainer(
        mockContainer,
        ["echo", "test"],
        5000,
        (chunk) => chunks.push(chunk),
      )

      const types = chunks.map((c) => c.type)
      expect(types).toContain("stdout")
      expect(types).toContain("stderr")
      expect(types).toContain("exit")
      expect(chunks.find((c) => c.type === "exit")!.data).toBe("0")
    })

    it("handles timeout", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      const chunks: any[] = []

      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()
        mockDockerInstance.modem.demuxStream.mockImplementation(() => {})
        cb(null, stream)
      })

      await expect(
        execStreamInContainer(
          mockContainer,
          ["sleep", "60"],
          50,
          (chunk) => chunks.push(chunk),
        ),
      ).rejects.toThrow("Command timed out after 50ms")

      expect(chunks.find((c) => c.type === "exit")).toBeTruthy()
    })

    it("handles exec start error", async () => {
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        cb(new Error("stream failed"), null)
      })

      await expect(
        execStreamInContainer(
          mockContainer,
          ["bad"],
          5000,
          vi.fn(),
        ),
      ).rejects.toThrow("stream failed")
    })
  })

  describe("getContainerStats", () => {
    it("calculates CPU%, memory, and network stats", async () => {
      mockContainer.stats.mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 200000 },
          system_cpu_usage: 2000000,
          online_cpus: 4,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100000 },
          system_cpu_usage: 1000000,
        },
        memory_stats: {
          usage: 256 * 1024 * 1024,
          limit: 512 * 1024 * 1024,
        },
        networks: {
          eth0: { rx_bytes: 1024, tx_bytes: 2048 },
        },
        pids_stats: { current: 5 },
      })
      mockContainer.inspect.mockResolvedValue({
        Id: "abc123456789",
        Config: { Labels: { "iii-sandbox-id": "sbx_test" } },
      })

      const result = await getContainerStats(mockContainer)

      expect(result.sandboxId).toBe("sbx_test")
      expect(result.cpuPercent).toBe(40)
      expect(result.memoryUsageMb).toBe(256)
      expect(result.memoryLimitMb).toBe(512)
      expect(result.networkRxBytes).toBe(1024)
      expect(result.networkTxBytes).toBe(2048)
      expect(result.pids).toBe(5)
    })

    it("returns 0 cpu when systemDelta is 0", async () => {
      mockContainer.stats.mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 100000 },
          system_cpu_usage: 1000000,
          online_cpus: 1,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100000 },
          system_cpu_usage: 1000000,
        },
        memory_stats: { usage: 0, limit: 512 * 1024 * 1024 },
        networks: {},
        pids_stats: {},
      })
      mockContainer.inspect.mockResolvedValue({
        Id: "abc123456789",
        Config: { Labels: {} },
      })

      const result = await getContainerStats(mockContainer)

      expect(result.cpuPercent).toBe(0)
      expect(result.networkRxBytes).toBe(0)
      expect(result.networkTxBytes).toBe(0)
      expect(result.pids).toBe(0)
    })

    it("falls back to container ID when no sandbox label", async () => {
      mockContainer.stats.mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 0 },
          system_cpu_usage: 0,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 0 },
          system_cpu_usage: 0,
        },
        memory_stats: { usage: 0, limit: 1 },
        pids_stats: {},
      })
      mockContainer.inspect.mockResolvedValue({
        Id: "abcdef123456extra",
        Config: { Labels: {} },
      })

      const result = await getContainerStats(mockContainer)

      expect(result.sandboxId).toBe("abcdef123456")
    })
  })

  describe("listContainerDir", () => {
    it("parses find output correctly", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()

        mockDockerInstance.modem.demuxStream.mockImplementation(
          (_s: any, stdoutStream: any, _stderrStream: any) => {
            stdoutStream.write(
              Buffer.from(
                ".\t4096\t1700000000.0\td\nfile.txt\t1024\t1700000001.0\tf\nsubdir\t4096\t1700000002.0\td\n",
              ),
            )
            process.nextTick(() => stream.emit("end"))
          },
        )

        cb(null, stream)
      })
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 })

      const result = await listContainerDir(mockContainer, "/workspace")

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe("file.txt")
      expect(result[0].path).toBe("/workspace/file.txt")
      expect(result[0].size).toBe(1024)
      expect(result[0].isDirectory).toBe(false)
      expect(result[1].name).toBe("subdir")
      expect(result[1].isDirectory).toBe(true)
    })

    it("handles empty results", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()
        mockDockerInstance.modem.demuxStream.mockImplementation(
          (_s: any, _stdoutStream: any, _stderrStream: any) => {
            process.nextTick(() => stream.emit("end"))
          },
        )
        cb(null, stream)
      })
      mockExec.inspect.mockResolvedValue({ ExitCode: 1 })

      const result = await listContainerDir(mockContainer, "/nonexistent")

      expect(result).toEqual([])
    })
  })

  describe("searchInContainer", () => {
    it("returns file paths", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()

        mockDockerInstance.modem.demuxStream.mockImplementation(
          (_s: any, stdoutStream: any, _stderrStream: any) => {
            stdoutStream.write(
              Buffer.from("/workspace/src/index.ts\n/workspace/src/app.ts\n"),
            )
            process.nextTick(() => stream.emit("end"))
          },
        )

        cb(null, stream)
      })
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 })

      const result = await searchInContainer(mockContainer, "/workspace", "*.ts")

      expect(result).toEqual(["/workspace/src/index.ts", "/workspace/src/app.ts"])
    })

    it("handles no results", async () => {
      const { PassThrough } = require("node:stream")
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockImplementation((_opts: any, cb: Function) => {
        const stream = new PassThrough()
        mockDockerInstance.modem.demuxStream.mockImplementation(
          (_s: any, _stdoutStream: any, _stderrStream: any) => {
            process.nextTick(() => stream.emit("end"))
          },
        )
        cb(null, stream)
      })
      mockExec.inspect.mockResolvedValue({ ExitCode: 1 })

      const result = await searchInContainer(mockContainer, "/workspace", "*.xyz")

      expect(result).toEqual([])
    })
  })

  describe("execBackground", () => {
    it("returns exec id and pid", async () => {
      mockContainer.exec.mockResolvedValue(mockExec)
      mockExec.start.mockResolvedValue(undefined)
      mockExec.inspect.mockResolvedValue({ ID: "exec-abc123", Pid: 42 })

      const result = await execBackground(mockContainer, ["python", "server.py"])

      expect(mockContainer.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ["python", "server.py"],
          Detach: true,
        }),
      )
      expect(result.id).toBe("exec-abc123")
      expect(result.pid).toBe(42)
    })
  })
})
