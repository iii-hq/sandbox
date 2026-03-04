import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("iii-sdk", async (importOriginal) => {
  const original = await importOriginal() as any
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  }
})

const mockGetDocker = vi.fn()

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => mockGetDocker(),
}))

import { registerPortFunctions } from "../../packages/engine/src/functions/port.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("Port Functions", () => {
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
    kvStore.set("sbx_test", { ...runningSandbox, metadata: {} })

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
      getContainer: () => ({
        inspect: vi.fn().mockResolvedValue({
          NetworkSettings: { Ports: {} },
        }),
      }),
    })

    registerPortFunctions(sdk, kv as any, config)
  })

  describe("port::expose", () => {
    it("exposes a port and stores mapping in metadata", async () => {
      const fn = handlers.get("port::expose")!
      const result = await fn({ id: "sbx_test", containerPort: 8080 })

      expect(result).toEqual({
        containerPort: 8080,
        hostPort: 8080,
        protocol: "tcp",
        state: "mapped",
      })

      expect(kv.set).toHaveBeenCalledWith(
        "sandbox",
        "sbx_test",
        expect.objectContaining({
          metadata: expect.objectContaining({
            ports: expect.any(String),
          }),
        }),
      )
    })

    it("uses custom host port and protocol", async () => {
      const fn = handlers.get("port::expose")!
      const result = await fn({
        id: "sbx_test",
        containerPort: 3000,
        hostPort: 9000,
        protocol: "udp",
      })

      expect(result).toEqual({
        containerPort: 3000,
        hostPort: 9000,
        protocol: "udp",
        state: "mapped",
      })
    })

    it("detects active port from docker inspect", async () => {
      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          inspect: vi.fn().mockResolvedValue({
            NetworkSettings: {
              Ports: {
                "8080/tcp": [{ HostIp: "0.0.0.0", HostPort: "32768" }],
              },
            },
          }),
        }),
      })

      const fn = handlers.get("port::expose")!
      const result = await fn({ id: "sbx_test", containerPort: 8080 })

      expect(result.hostPort).toBe(32768)
      expect(result.state).toBe("active")
    })

    it("throws for non-existent sandbox", async () => {
      const fn = handlers.get("port::expose")!
      await expect(fn({ id: "sbx_missing", containerPort: 80 })).rejects.toThrow("Sandbox not found")
    })

    it("throws for non-running sandbox", async () => {
      kvStore.set("sbx_paused", { ...runningSandbox, id: "sbx_paused", status: "paused", metadata: {} })
      const fn = handlers.get("port::expose")!
      await expect(fn({ id: "sbx_paused", containerPort: 80 })).rejects.toThrow("not running")
    })

    it("throws for invalid container port", async () => {
      const fn = handlers.get("port::expose")!
      await expect(fn({ id: "sbx_test", containerPort: 0 })).rejects.toThrow("Invalid container port")
      await expect(fn({ id: "sbx_test", containerPort: 70000 })).rejects.toThrow("Invalid container port")
    })

    it("throws for invalid protocol", async () => {
      const fn = handlers.get("port::expose")!
      await expect(fn({ id: "sbx_test", containerPort: 80, protocol: "sctp" })).rejects.toThrow("Invalid protocol")
    })

    it("throws for duplicate port mapping", async () => {
      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: { ports: JSON.stringify([{ containerPort: 80, hostPort: 80, protocol: "tcp", state: "mapped" }]) },
      })

      const fn = handlers.get("port::expose")!
      await expect(fn({ id: "sbx_test", containerPort: 80 })).rejects.toThrow("already exposed")
    })

    it("throws for invalid host port", async () => {
      const fn = handlers.get("port::expose")!
      await expect(fn({ id: "sbx_test", containerPort: 80, hostPort: -1 })).rejects.toThrow("Invalid host port")
    })
  })

  describe("port::list", () => {
    it("returns empty ports array when none exposed", async () => {
      const fn = handlers.get("port::list")!
      const result = await fn({ id: "sbx_test" })

      expect(result).toEqual({ ports: [] })
    })

    it("returns stored port mappings", async () => {
      const ports = [
        { containerPort: 80, hostPort: 80, protocol: "tcp", state: "mapped" },
        { containerPort: 443, hostPort: 443, protocol: "tcp", state: "mapped" },
      ]
      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: { ports: JSON.stringify(ports) },
      })

      const fn = handlers.get("port::list")!
      const result = await fn({ id: "sbx_test" })

      expect(result.ports).toHaveLength(2)
      expect(result.ports[0].containerPort).toBe(80)
      expect(result.ports[1].containerPort).toBe(443)
    })

    it("updates state from docker inspect", async () => {
      mockGetDocker.mockReturnValue({
        getContainer: () => ({
          inspect: vi.fn().mockResolvedValue({
            NetworkSettings: {
              Ports: {
                "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "80" }],
              },
            },
          }),
        }),
      })

      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: {
          ports: JSON.stringify([
            { containerPort: 80, hostPort: 80, protocol: "tcp", state: "mapped" },
          ]),
        },
      })

      const fn = handlers.get("port::list")!
      const result = await fn({ id: "sbx_test" })

      expect(result.ports[0].state).toBe("active")
    })

    it("throws for non-existent sandbox", async () => {
      const fn = handlers.get("port::list")!
      await expect(fn({ id: "sbx_missing" })).rejects.toThrow("Sandbox not found")
    })
  })

  describe("port::unexpose", () => {
    it("removes a port mapping", async () => {
      kvStore.set("sbx_test", {
        ...runningSandbox,
        metadata: {
          ports: JSON.stringify([
            { containerPort: 80, hostPort: 80, protocol: "tcp", state: "mapped" },
            { containerPort: 443, hostPort: 443, protocol: "tcp", state: "mapped" },
          ]),
        },
      })

      const fn = handlers.get("port::unexpose")!
      const result = await fn({ id: "sbx_test", containerPort: 80 })

      expect(result).toEqual({ removed: 80 })

      const updated = kvStore.get("sbx_test")
      const remaining = JSON.parse(updated.metadata.ports)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].containerPort).toBe(443)
    })

    it("throws for non-existent sandbox", async () => {
      const fn = handlers.get("port::unexpose")!
      await expect(fn({ id: "sbx_missing", containerPort: 80 })).rejects.toThrow("Sandbox not found")
    })

    it("throws when port is not exposed", async () => {
      const fn = handlers.get("port::unexpose")!
      await expect(fn({ id: "sbx_test", containerPort: 9999 })).rejects.toThrow("not exposed")
    })
  })
})
