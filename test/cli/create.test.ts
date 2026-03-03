import { describe, it, expect, vi, beforeEach } from "vitest"
import { createCommand } from "../../packages/cli/src/commands/create"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

import { createSandbox } from "@iii-sandbox/sdk"

const mockCreateSandbox = vi.mocked(createSandbox)

describe("createCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  const mockSandbox = {
    id: "sbx-abc123",
    info: {
      image: "ubuntu:22.04",
      status: "running",
      expiresAt: "2026-03-03T12:00:00.000Z",
    },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    mockCreateSandbox.mockResolvedValue(mockSandbox as any)
  })

  it("calls createSandbox with image and config", async () => {
    await createCommand("ubuntu:22.04", {}, config)

    expect(mockCreateSandbox).toHaveBeenCalledWith({
      image: "ubuntu:22.04",
      baseUrl: "http://localhost:3000",
      token: "test-token",
    })
  })

  it("passes options through to createSandbox", async () => {
    const opts = { name: "my-sandbox", timeout: 300, memory: 512, network: true }
    await createCommand("node:20", opts, config)

    expect(mockCreateSandbox).toHaveBeenCalledWith({
      image: "node:20",
      name: "my-sandbox",
      timeout: 300,
      memory: 512,
      network: true,
      baseUrl: "http://localhost:3000",
      token: "test-token",
    })
  })

  it("logs sandbox info", async () => {
    await createCommand("ubuntu:22.04", {}, config)

    expect(console.log).toHaveBeenCalledWith("Created sandbox: sbx-abc123")
    expect(console.log).toHaveBeenCalledWith("  Image: ubuntu:22.04")
    expect(console.log).toHaveBeenCalledWith("  Status: running")
    expect(console.log).toHaveBeenCalledWith("  Expires: 2026-03-03T12:00:00.000Z")
  })

  it("returns the created sandbox", async () => {
    const result = await createCommand("ubuntu:22.04", {}, config)

    expect(result).toBe(mockSandbox)
  })
})
