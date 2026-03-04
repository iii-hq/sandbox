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
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    mockSandbox = {
      streams: {
        logs: vi.fn(),
      },
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("gets the sandbox by id", async () => {
    mockSandbox.streams.logs.mockReturnValue((async function* () {})())

    await logsCommand("sbx-123", config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
  })

  it("calls streams.logs with tail and follow options", async () => {
    mockSandbox.streams.logs.mockReturnValue((async function* () {})())

    await logsCommand("sbx-123", config)

    expect(mockSandbox.streams.logs).toHaveBeenCalledWith({ tail: 100, follow: false })
  })

  it("prints log output with type prefix", async () => {
    mockSandbox.streams.logs.mockReturnValue(
      (async function* () {
        yield { type: "stdout", data: "service started", timestamp: 1000 }
        yield { type: "stderr", data: "warning: low memory", timestamp: 1001 }
        yield { type: "end", data: "", timestamp: 1002 }
      })(),
    )

    await logsCommand("sbx-123", config)

    expect(writeSpy).toHaveBeenCalledWith("[stdout] service started\n")
    expect(writeSpy).toHaveBeenCalledWith("[stderr] warning: low memory\n")
  })

  it("handles empty log stream", async () => {
    mockSandbox.streams.logs.mockReturnValue((async function* () {})())

    await logsCommand("sbx-123", config)

    expect(writeSpy).not.toHaveBeenCalled()
  })
})
