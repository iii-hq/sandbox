import { describe, it, expect, vi, beforeEach } from "vitest"
import { killCommand } from "../../packages/cli/src/commands/kill"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

import { getSandbox } from "@iii-sandbox/sdk"

const mockGetSandbox = vi.mocked(getSandbox)

describe("killCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})

    mockSandbox = {
      kill: vi.fn().mockResolvedValue(undefined),
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("gets the sandbox by id", async () => {
    await killCommand("sbx-456", config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-456", config)
  })

  it("calls kill on the sandbox", async () => {
    await killCommand("sbx-456", config)

    expect(mockSandbox.kill).toHaveBeenCalled()
  })

  it("logs confirmation with sandbox id", async () => {
    await killCommand("sbx-456", config)

    expect(console.log).toHaveBeenCalledWith("Killed sandbox: sbx-456")
  })

  it("awaits kill before logging", async () => {
    const callOrder: string[] = []
    mockSandbox.kill.mockImplementation(() => {
      callOrder.push("kill")
      return Promise.resolve()
    })
    vi.mocked(console.log).mockImplementation(() => {
      callOrder.push("log")
    })

    await killCommand("sbx-789", config)

    expect(callOrder).toEqual(["kill", "log"])
  })
})
