import { describe, it, expect, vi, beforeEach } from "vitest"
import { listCommand } from "../../packages/cli/src/commands/list"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

import { listSandboxes } from "@iii-sandbox/sdk"

const mockListSandboxes = vi.mocked(listSandboxes)

describe("listCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("shows message when no sandboxes exist", async () => {
    mockListSandboxes.mockResolvedValue([])

    await listCommand(config)

    expect(console.log).toHaveBeenCalledWith("No active sandboxes")
  })

  it("does not print header when no sandboxes", async () => {
    mockListSandboxes.mockResolvedValue([])

    await listCommand(config)

    expect(console.log).toHaveBeenCalledTimes(1)
  })

  it("calls listSandboxes with config", async () => {
    mockListSandboxes.mockResolvedValue([])

    await listCommand(config)

    expect(mockListSandboxes).toHaveBeenCalledWith(config)
  })

  it("prints header and rows for sandboxes", async () => {
    const sandboxes = [
      { id: "sbx-111", image: "ubuntu:22.04", status: "running", expiresAt: "2026-03-03T12:00:00.000Z" },
      { id: "sbx-222", image: "node:20", status: "paused", expiresAt: "2026-03-03T14:00:00.000Z" },
    ]
    mockListSandboxes.mockResolvedValue(sandboxes as any)

    await listCommand(config)

    const calls = vi.mocked(console.log).mock.calls.map((c) => c[0])

    expect(calls[0]).toContain("ID")
    expect(calls[0]).toContain("IMAGE")
    expect(calls[0]).toContain("STATUS")
    expect(calls[0]).toContain("EXPIRES")

    expect(calls[1]).toContain("sbx-111")
    expect(calls[1]).toContain("ubuntu:22.04")
    expect(calls[1]).toContain("running")

    expect(calls[2]).toContain("sbx-222")
    expect(calls[2]).toContain("node:20")
    expect(calls[2]).toContain("paused")
  })

  it("prints one header plus one row per sandbox", async () => {
    const sandboxes = [
      { id: "sbx-a", image: "alpine", status: "running", expiresAt: "2026-03-03T12:00:00.000Z" },
      { id: "sbx-b", image: "debian", status: "stopped", expiresAt: "2026-03-03T13:00:00.000Z" },
      { id: "sbx-c", image: "fedora", status: "running", expiresAt: "2026-03-03T14:00:00.000Z" },
    ]
    mockListSandboxes.mockResolvedValue(sandboxes as any)

    await listCommand(config)

    expect(console.log).toHaveBeenCalledTimes(4)
  })
})
