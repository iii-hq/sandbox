import { describe, it, expect, vi, beforeEach } from "vitest"
import { logsCommand } from "../../packages/cli/src/commands/logs"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

import { getSandbox } from "@iii-sandbox/sdk"

const mockGetSandbox = vi.mocked(getSandbox)

describe("logsCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})

    mockSandbox = {
      exec: vi.fn(),
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("gets the sandbox by id", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "" })

    await logsCommand("sbx-123", config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
  })

  it("executes the log reading command", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "" })

    await logsCommand("sbx-123", config)

    expect(mockSandbox.exec).toHaveBeenCalledWith(
      "cat /var/log/*.log 2>/dev/null || echo 'No logs found'",
    )
  })

  it("prints log output", async () => {
    mockSandbox.exec.mockResolvedValue({
      stdout: "2026-03-03 error: something failed\n2026-03-03 info: service started\n",
    })

    await logsCommand("sbx-123", config)

    expect(console.log).toHaveBeenCalledWith(
      "2026-03-03 error: something failed\n2026-03-03 info: service started\n",
    )
  })

  it("prints empty string when no logs", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "No logs found\n" })

    await logsCommand("sbx-123", config)

    expect(console.log).toHaveBeenCalledWith("No logs found\n")
  })
})
