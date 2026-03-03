import { describe, it, expect, vi, beforeEach } from "vitest"
import { execCommand } from "../../packages/cli/src/commands/exec"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

import { getSandbox } from "@iii-sandbox/sdk"

const mockGetSandbox = vi.mocked(getSandbox)

describe("execCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never)

    mockSandbox = {
      exec: vi.fn(),
      execStream: vi.fn(),
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("writes stdout from exec result", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "hello\n", stderr: "", exitCode: 0 })

    await execCommand("sbx-123", "echo hello", {}, config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
    expect(mockSandbox.exec).toHaveBeenCalledWith("echo hello", undefined)
    expect(process.stdout.write).toHaveBeenCalledWith("hello\n")
  })

  it("writes stderr from exec result", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "", stderr: "error msg\n", exitCode: 0 })

    await execCommand("sbx-123", "bad-cmd", {}, config)

    expect(process.stderr.write).toHaveBeenCalledWith("error msg\n")
  })

  it("passes timeout option to exec", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 })

    await execCommand("sbx-123", "sleep 5", { timeout: 10000 }, config)

    expect(mockSandbox.exec).toHaveBeenCalledWith("sleep 5", 10000)
  })

  it("exits with non-zero exit code", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 })

    await execCommand("sbx-123", "false", {}, config)

    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it("does not exit when exit code is 0", async () => {
    mockSandbox.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 })

    await execCommand("sbx-123", "true", {}, config)

    expect(process.exit).not.toHaveBeenCalled()
  })

  it("streams stdout chunks in stream mode", async () => {
    const chunks = [
      { type: "stdout", data: "line1\n" },
      { type: "stderr", data: "warn\n" },
      { type: "stdout", data: "line2\n" },
    ]
    mockSandbox.execStream.mockResolvedValue({
      [Symbol.asyncIterator]: () => {
        let i = 0
        return {
          next: () =>
            i < chunks.length
              ? Promise.resolve({ value: chunks[i++], done: false })
              : Promise.resolve({ value: undefined, done: true }),
        }
      },
    })

    await execCommand("sbx-123", "ls", { stream: true }, config)

    expect(mockSandbox.execStream).toHaveBeenCalledWith("ls")
    expect(process.stdout.write).toHaveBeenCalledWith("line1\n")
    expect(process.stderr.write).toHaveBeenCalledWith("warn\n")
    expect(process.stdout.write).toHaveBeenCalledWith("line2\n")
  })

  it("does not call exec in stream mode", async () => {
    mockSandbox.execStream.mockResolvedValue({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ value: undefined, done: true }),
      }),
    })

    await execCommand("sbx-123", "ls", { stream: true }, config)

    expect(mockSandbox.exec).not.toHaveBeenCalled()
  })
})
