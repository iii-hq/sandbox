import { describe, it, expect, vi, beforeEach } from "vitest"

const mockContainer = {
  stop: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}

const mockDocker = {
  getContainer: vi.fn().mockReturnValue(mockContainer),
}

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => mockDocker,
}))

import { cleanupAll } from "../../packages/engine/src/lifecycle/cleanup.js"

describe("Cleanup", () => {
  let kvStore: Map<string, Map<string, any>>
  let kvMock: any

  beforeEach(() => {
    vi.clearAllMocks()
    kvStore = new Map()
    kvStore.set("sandbox", new Map())

    kvMock = {
      get: vi.fn(async (scope: string, key: string) => kvStore.get(scope)?.get(key) ?? null),
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
  })

  it("cleans up all sandboxes from KV", async () => {
    kvStore.get("sandbox")!.set("sbx_1", { id: "sbx_1", status: "running" })
    kvStore.get("sandbox")!.set("sbx_2", { id: "sbx_2", status: "paused" })
    kvStore.get("sandbox")!.set("sbx_3", { id: "sbx_3", status: "running" })

    await cleanupAll(kvMock)

    expect(kvMock.delete).toHaveBeenCalledTimes(3)
    expect(kvMock.delete).toHaveBeenCalledWith("sandbox", "sbx_1")
    expect(kvMock.delete).toHaveBeenCalledWith("sandbox", "sbx_2")
    expect(kvMock.delete).toHaveBeenCalledWith("sandbox", "sbx_3")
  })

  it("stops and removes each container", async () => {
    kvStore.get("sandbox")!.set("sbx_a", { id: "sbx_a", status: "running" })
    kvStore.get("sandbox")!.set("sbx_b", { id: "sbx_b", status: "running" })

    await cleanupAll(kvMock)

    expect(mockDocker.getContainer).toHaveBeenCalledWith("iii-sbx-sbx_a")
    expect(mockDocker.getContainer).toHaveBeenCalledWith("iii-sbx-sbx_b")
    expect(mockContainer.stop).toHaveBeenCalledTimes(2)
    expect(mockContainer.remove).toHaveBeenCalledTimes(2)
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
  })

  it("continues on container errors", async () => {
    const failContainer = {
      stop: vi.fn().mockRejectedValue(new Error("not found")),
      remove: vi.fn().mockRejectedValue(new Error("not found")),
    }

    mockDocker.getContainer
      .mockReturnValueOnce(failContainer)
      .mockReturnValueOnce(mockContainer)

    kvStore.get("sandbox")!.set("sbx_fail", { id: "sbx_fail", status: "running" })
    kvStore.get("sandbox")!.set("sbx_ok", { id: "sbx_ok", status: "running" })

    await cleanupAll(kvMock)

    expect(kvMock.delete).toHaveBeenCalledTimes(2)
    expect(kvMock.delete).toHaveBeenCalledWith("sandbox", "sbx_fail")
    expect(kvMock.delete).toHaveBeenCalledWith("sandbox", "sbx_ok")
  })

  it("handles empty sandbox list", async () => {
    await cleanupAll(kvMock)

    expect(mockDocker.getContainer).not.toHaveBeenCalled()
    expect(mockContainer.stop).not.toHaveBeenCalled()
    expect(kvMock.delete).not.toHaveBeenCalled()
  })
})
