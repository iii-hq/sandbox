import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  fileReadCommand,
  fileWriteCommand,
  fileUploadCommand,
  fileListCommand,
} from "../../packages/cli/src/commands/file"

vi.mock("@iii-sandbox/sdk", () => ({
  createSandbox: vi.fn(),
  getSandbox: vi.fn(),
  listSandboxes: vi.fn(),
}))

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from("file content")),
}))

import { getSandbox } from "@iii-sandbox/sdk"
import { readFileSync } from "node:fs"

const mockGetSandbox = vi.mocked(getSandbox)
const mockReadFileSync = vi.mocked(readFileSync)

describe("fileReadCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    vi.spyOn(console, "log").mockImplementation(() => {})

    mockSandbox = {
      filesystem: {
        read: vi.fn(),
        write: vi.fn(),
        upload: vi.fn(),
        list: vi.fn(),
      },
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
    mockReadFileSync.mockReturnValue(Buffer.from("file content"))
  })

  it("reads file and writes content to stdout", async () => {
    mockSandbox.filesystem.read.mockResolvedValue("file data here")

    await fileReadCommand("sbx-123", "/app/main.py", config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
    expect(mockSandbox.filesystem.read).toHaveBeenCalledWith("/app/main.py")
    expect(process.stdout.write).toHaveBeenCalledWith("file data here")
  })
})

describe("fileWriteCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})

    mockSandbox = {
      filesystem: {
        read: vi.fn(),
        write: vi.fn(),
        upload: vi.fn(),
        list: vi.fn(),
      },
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("writes content to file and logs path", async () => {
    mockSandbox.filesystem.write.mockResolvedValue(undefined)

    await fileWriteCommand("sbx-123", "/app/config.json", '{"key":"val"}', config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
    expect(mockSandbox.filesystem.write).toHaveBeenCalledWith("/app/config.json", '{"key":"val"}')
    expect(console.log).toHaveBeenCalledWith("Written: /app/config.json")
  })
})

describe("fileUploadCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})

    mockSandbox = {
      filesystem: {
        read: vi.fn(),
        write: vi.fn(),
        upload: vi.fn(),
        list: vi.fn(),
      },
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
    mockReadFileSync.mockReturnValue(Buffer.from("file content"))
  })

  it("reads local file with readFileSync", async () => {
    mockSandbox.filesystem.upload.mockResolvedValue(undefined)

    await fileUploadCommand("sbx-123", "./local.txt", "/remote/file.txt", config)

    expect(mockReadFileSync).toHaveBeenCalledWith("./local.txt")
  })

  it("uploads base64 encoded content", async () => {
    mockSandbox.filesystem.upload.mockResolvedValue(undefined)

    await fileUploadCommand("sbx-123", "./local.txt", "/remote/file.txt", config)

    const expectedBase64 = Buffer.from("file content").toString("base64")
    expect(mockSandbox.filesystem.upload).toHaveBeenCalledWith("/remote/file.txt", expectedBase64)
  })

  it("logs upload confirmation", async () => {
    mockSandbox.filesystem.upload.mockResolvedValue(undefined)

    await fileUploadCommand("sbx-123", "./data.bin", "/sandbox/data.bin", config)

    expect(console.log).toHaveBeenCalledWith("Uploaded: ./data.bin -> /sandbox/data.bin")
  })
})

describe("fileListCommand", () => {
  const config = { baseUrl: "http://localhost:3000", token: "test-token" }
  let mockSandbox: any

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})

    mockSandbox = {
      filesystem: {
        read: vi.fn(),
        write: vi.fn(),
        upload: vi.fn(),
        list: vi.fn(),
      },
    }
    mockGetSandbox.mockResolvedValue(mockSandbox)
  })

  it("lists files with type, size, and name", async () => {
    const files = [
      { name: "src", isDirectory: true, size: 4096 },
      { name: "main.py", isDirectory: false, size: 1234 },
      { name: "README.md", isDirectory: false, size: 567 },
    ]
    mockSandbox.filesystem.list.mockResolvedValue(files)

    await fileListCommand("sbx-123", "/app", config)

    expect(mockGetSandbox).toHaveBeenCalledWith("sbx-123", config)
    expect(mockSandbox.filesystem.list).toHaveBeenCalledWith("/app")

    const calls = vi.mocked(console.log).mock.calls.map((c) => c[0])
    expect(calls[0]).toContain("d")
    expect(calls[0]).toContain("4096")
    expect(calls[0]).toContain("src")

    expect(calls[1]).toContain("-")
    expect(calls[1]).toContain("1234")
    expect(calls[1]).toContain("main.py")

    expect(calls[2]).toContain("-")
    expect(calls[2]).toContain("567")
    expect(calls[2]).toContain("README.md")
  })

  it("prints one line per file", async () => {
    const files = [
      { name: "a.txt", isDirectory: false, size: 10 },
      { name: "b.txt", isDirectory: false, size: 20 },
    ]
    mockSandbox.filesystem.list.mockResolvedValue(files)

    await fileListCommand("sbx-123", "/", config)

    expect(console.log).toHaveBeenCalledTimes(2)
  })

  it("handles empty directory", async () => {
    mockSandbox.filesystem.list.mockResolvedValue([])

    await fileListCommand("sbx-123", "/empty", config)

    expect(console.log).not.toHaveBeenCalled()
  })
})
