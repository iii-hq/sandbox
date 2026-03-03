import { describe, it, expect, vi, beforeEach } from "vitest"
import { CodeInterpreter } from "../../packages/sdk/src/interpreter.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("CodeInterpreter", () => {
  let mockClient: HttpClient
  let interp: CodeInterpreter

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient
    interp = new CodeInterpreter(mockClient, "sbx_test")
  })

  describe("run", () => {
    it("sends code with default language python", async () => {
      const result = { output: "2", executionTime: 50 }
      ;(mockClient.post as any).mockResolvedValue(result)

      const res = await interp.run("print(1+1)")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/execute",
        { code: "print(1+1)", language: "python" },
      )
      expect(res).toEqual(result)
    })

    it("sends code with custom language", async () => {
      ;(mockClient.post as any).mockResolvedValue({ output: "", executionTime: 10 })

      await interp.run("console.log(1)", "javascript")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/execute",
        { code: "console.log(1)", language: "javascript" },
      )
    })

    it("returns error field when code fails", async () => {
      const result = { output: "", error: "SyntaxError", executionTime: 5 }
      ;(mockClient.post as any).mockResolvedValue(result)

      const res = await interp.run("invalid(((")
      expect(res.error).toBe("SyntaxError")
    })
  })

  describe("install", () => {
    it("installs pip packages by default", async () => {
      ;(mockClient.post as any).mockResolvedValue({ output: "Successfully installed numpy" })

      const result = await interp.install(["numpy"])

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/install",
        { packages: ["numpy"], manager: "pip" },
      )
      expect(result).toBe("Successfully installed numpy")
    })

    it("installs npm packages", async () => {
      ;(mockClient.post as any).mockResolvedValue({ output: "added 1 package" })

      await interp.install(["lodash"], "npm")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/install",
        { packages: ["lodash"], manager: "npm" },
      )
    })

    it("installs go packages", async () => {
      ;(mockClient.post as any).mockResolvedValue({ output: "go: added module" })

      await interp.install(["github.com/gin-gonic/gin"], "go")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/install",
        { packages: ["github.com/gin-gonic/gin"], manager: "go" },
      )
    })

    it("installs multiple packages at once", async () => {
      ;(mockClient.post as any).mockResolvedValue({ output: "installed" })

      await interp.install(["numpy", "pandas", "scipy"])

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/install",
        { packages: ["numpy", "pandas", "scipy"], manager: "pip" },
      )
    })
  })

  describe("kernels", () => {
    it("fetches available kernels", async () => {
      const kernels = [
        { name: "python3", language: "python", displayName: "Python 3" },
        { name: "javascript", language: "javascript", displayName: "JavaScript" },
      ]
      ;(mockClient.get as any).mockResolvedValue(kernels)

      const result = await interp.kernels()

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/interpret/kernels",
      )
      expect(result).toEqual(kernels)
      expect(result).toHaveLength(2)
    })
  })
})
