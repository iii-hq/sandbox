import { describe, it, expect, vi, beforeEach } from "vitest"
import { registerApiTriggers } from "../../packages/engine/src/triggers/api.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("API Triggers", () => {
  let sdk: any
  let registeredFunctions: Map<string, Function>
  let registeredTriggers: Array<any>

  const config: EngineConfig = {
    apiPrefix: "/sandbox",
    maxSandboxes: 50,
    defaultTimeout: 3600,
    defaultMemory: 512,
    defaultCpu: 1,
    maxCommandTimeout: 300,
    workspaceDir: "/workspace",
    allowedImages: ["*"],
    authToken: "test-token",
    engineUrl: "ws://localhost:49134",
    workerName: "test",
    restPort: 3111,
    maxFileSize: 10485760,
    cleanupOnExit: true,
  }

  beforeEach(() => {
    registeredFunctions = new Map()
    registeredTriggers = []

    sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        registeredFunctions.set(meta.id, handler)
      }),
      registerTrigger: vi.fn((trigger: any) => {
        registeredTriggers.push(trigger)
      }),
      trigger: vi.fn(),
    }
  })

  it("registers all API triggers", () => {
    registerApiTriggers(sdk, config)

    expect(registeredTriggers.length).toBeGreaterThanOrEqual(30)
  })

  it("all triggers have http type", () => {
    registerApiTriggers(sdk, config)

    for (const trigger of registeredTriggers) {
      expect(trigger.type).toBe("http")
    }
  })

  it("all trigger paths start with /sandbox", () => {
    registerApiTriggers(sdk, config)

    for (const trigger of registeredTriggers) {
      expect(trigger.config.api_path).toMatch(/^\/sandbox/)
    }
  })

  it("registers sandbox CRUD endpoints", () => {
    registerApiTriggers(sdk, config)

    const paths = registeredTriggers.map((t: any) => `${t.config.http_method} ${t.config.api_path}`)
    expect(paths).toContain("POST /sandbox/sandboxes")
    expect(paths).toContain("GET /sandbox/sandboxes")
    expect(paths).toContain("GET /sandbox/sandboxes/:id")
    expect(paths).toContain("DELETE /sandbox/sandboxes/:id")
  })

  it("registers command endpoints", () => {
    registerApiTriggers(sdk, config)

    const paths = registeredTriggers.map((t: any) => `${t.config.http_method} ${t.config.api_path}`)
    expect(paths).toContain("POST /sandbox/sandboxes/:id/exec")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/exec/stream")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/exec/background")
  })

  it("registers filesystem endpoints", () => {
    registerApiTriggers(sdk, config)

    const paths = registeredTriggers.map((t: any) => `${t.config.http_method} ${t.config.api_path}`)
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/read")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/write")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/delete")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/list")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/move")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/mkdir")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/rmdir")
    expect(paths).toContain("POST /sandbox/sandboxes/:id/files/chmod")
  })

  it("registers health endpoint without auth", () => {
    registerApiTriggers(sdk, config)

    const paths = registeredTriggers.map((t: any) => `${t.config.http_method} ${t.config.api_path}`)
    expect(paths).toContain("GET /sandbox/health")
  })

  describe("API handler wrap function", () => {
    it("returns 200 on successful trigger", async () => {
      sdk.trigger.mockResolvedValue({ id: "sbx_1" })
      registerApiTriggers(sdk, config)

      const handler = registeredFunctions.get("api::sandbox::create")
      const req = {
        path_params: {},
        query_params: {},
        body: { image: "python:3.12-slim" },
        headers: { authorization: "Bearer test-token" },
        method: "POST",
      }

      const response = await handler!(req)
      expect(response.status_code).toBe(200)
    })

    it("returns 404 for not found errors", async () => {
      sdk.trigger.mockRejectedValue(new Error("Sandbox not found: sbx_missing"))
      registerApiTriggers(sdk, config)

      const handler = registeredFunctions.get("api::sandbox::get")
      const req = {
        path_params: { id: "sbx_missing" },
        query_params: {},
        body: {},
        headers: { authorization: "Bearer test-token" },
        method: "GET",
      }

      const response = await handler!(req)
      expect(response.status_code).toBe(404)
      expect(response.body.error).toContain("not found")
    })

    it("returns 403 for not allowed errors", async () => {
      sdk.trigger.mockRejectedValue(new Error("Image not allowed: evil:latest"))
      registerApiTriggers(sdk, config)

      const handler = registeredFunctions.get("api::sandbox::create")
      const req = {
        path_params: {},
        query_params: {},
        body: { image: "evil:latest" },
        headers: { authorization: "Bearer test-token" },
        method: "POST",
      }

      const response = await handler!(req)
      expect(response.status_code).toBe(403)
    })

    it("returns 500 for generic errors", async () => {
      sdk.trigger.mockRejectedValue(new Error("Docker daemon unreachable"))
      registerApiTriggers(sdk, config)

      const handler = registeredFunctions.get("api::sandbox::create")
      const req = {
        path_params: {},
        query_params: {},
        body: { image: "python:3.12-slim" },
        headers: { authorization: "Bearer test-token" },
        method: "POST",
      }

      const response = await handler!(req)
      expect(response.status_code).toBe(500)
    })

    it("rejects requests without valid auth token", async () => {
      registerApiTriggers(sdk, config)

      const handler = registeredFunctions.get("api::sandbox::create")
      const req = {
        path_params: {},
        query_params: {},
        body: { image: "python:3.12-slim" },
        headers: {},
        method: "POST",
      }

      const response = await handler!(req)
      expect(response.status_code).toBe(401)
    })

    it("merges path_params, query_params, and body into trigger input", async () => {
      sdk.trigger.mockResolvedValue({ exitCode: 0 })
      registerApiTriggers(sdk, config)

      const handler = registeredFunctions.get("api::cmd::run")
      const req = {
        path_params: { id: "sbx_1" },
        query_params: {},
        body: { command: "ls" },
        headers: { authorization: "Bearer test-token" },
        method: "POST",
      }

      await handler!(req)
      expect(sdk.trigger).toHaveBeenCalledWith("cmd::run", {
        id: "sbx_1",
        command: "ls",
      })
    })
  })
})
