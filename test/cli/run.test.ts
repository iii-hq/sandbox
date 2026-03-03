import { describe, it, expect, vi, beforeEach } from "vitest"
import { runCommand } from "../../packages/cli/src/commands/run"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

import { getSandbox } from "@iii-sandbox/sdk"

const mockGetSandbox = vi.mocked(getSandbox)

describe("runCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    mockSandbox = {
      interpreter: {
        run: vi.fn(),
      },
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("runs code with default python language", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: "42", error: null })

    await runCommand("sbx-123", "print(42)", {}, config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
    expect(mockSandbox.interpreter.run).toHaveBeenCalledWith("print(42)", "python")
  })

  it("respects language option", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: "hello", error: null })

    await runCommand("sbx-123", "console.log('hello')", { language: "javascript" }, config)

    expect(mockSandbox.interpreter.run).toHaveBeenCalledWith("console.log('hello')", "javascript")
  })

  it("logs output when present", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: "result: 100", error: null })

    await runCommand("sbx-123", "print(100)", {}, config)

    expect(console.log).toHaveBeenCalledWith("result: 100")
  })

  it("does not log output when empty", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: "", error: null })

    await runCommand("sbx-123", "x = 1", {}, config)

    expect(console.log).not.toHaveBeenCalled()
  })

  it("logs errors when present", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: null, error: "NameError: name 'x' is not defined" })

    await runCommand("sbx-123", "print(x)", {}, config)

    expect(console.error).toHaveBeenCalledWith("NameError: name 'x' is not defined")
  })

  it("does not log error when empty", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: "ok", error: "" })

    await runCommand("sbx-123", "print('ok')", {}, config)

    expect(console.error).not.toHaveBeenCalled()
  })

  it("logs both output and error when both present", async () => {
    mockSandbox.interpreter.run.mockResolvedValue({ output: "partial", error: "warning: something" })

    await runCommand("sbx-123", "code", {}, config)

    expect(console.log).toHaveBeenCalledWith("partial")
    expect(console.error).toHaveBeenCalledWith("warning: something")
  })
})
