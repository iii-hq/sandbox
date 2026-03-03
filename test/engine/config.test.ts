import { describe, it, expect, afterEach } from "vitest"
import { loadConfig } from "../../packages/engine/src/config.js"

describe("loadConfig", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns defaults", () => {
    const config = loadConfig()
    expect(config.engineUrl).toBe("ws://localhost:49134")
    expect(config.workerName).toBe("iii-sandbox")
    expect(config.defaultMemory).toBe(512)
    expect(config.maxSandboxes).toBe(50)
  })

  it("reads from env", () => {
    process.env.III_MAX_SANDBOXES = "100"
    process.env.III_DEFAULT_MEMORY = "1024"
    const config = loadConfig()
    expect(config.maxSandboxes).toBe(100)
    expect(config.defaultMemory).toBe(1024)
  })

  it("reads multiple env var overrides at once", () => {
    process.env.III_REST_PORT = "4000"
    process.env.III_DEFAULT_TIMEOUT = "7200"
    process.env.III_DEFAULT_CPU = "2"
    process.env.III_MAX_SANDBOXES = "200"
    process.env.III_MAX_CMD_TIMEOUT = "600"
    const config = loadConfig()
    expect(config.restPort).toBe(4000)
    expect(config.defaultTimeout).toBe(7200)
    expect(config.defaultCpu).toBe(2)
    expect(config.maxSandboxes).toBe(200)
    expect(config.maxCommandTimeout).toBe(600)
  })

  it("handles string values for numeric fields via parseInt", () => {
    process.env.III_REST_PORT = "3000abc"
    const config = loadConfig()
    expect(config.restPort).toBe(3000)
  })

  it("returns NaN for completely non-numeric string", () => {
    process.env.III_REST_PORT = "abc"
    const config = loadConfig()
    expect(config.restPort).toBeNaN()
  })

  it("reads auth token from env", () => {
    process.env.III_AUTH_TOKEN = "my-secret-token"
    const config = loadConfig()
    expect(config.authToken).toBe("my-secret-token")
  })

  it("auth token defaults to null", () => {
    delete process.env.III_AUTH_TOKEN
    const config = loadConfig()
    expect(config.authToken).toBeNull()
  })

  it("parses allowed images from comma-separated env", () => {
    process.env.III_ALLOWED_IMAGES = "python:3.12,node:20,golang:1.22"
    const config = loadConfig()
    expect(config.allowedImages).toEqual(["python:3.12", "node:20", "golang:1.22"])
  })

  it("trims whitespace from allowed images", () => {
    process.env.III_ALLOWED_IMAGES = " python:3.12 , node:20 , golang:1.22 "
    const config = loadConfig()
    expect(config.allowedImages).toEqual(["python:3.12", "node:20", "golang:1.22"])
  })

  it("defaults allowed images to wildcard", () => {
    delete process.env.III_ALLOWED_IMAGES
    const config = loadConfig()
    expect(config.allowedImages).toEqual(["*"])
  })

  it("reads api prefix from env", () => {
    process.env.III_API_PREFIX = "/api/v1"
    const config = loadConfig()
    expect(config.apiPrefix).toBe("/api/v1")
  })

  it("defaults api prefix to /sandbox", () => {
    delete process.env.III_API_PREFIX
    const config = loadConfig()
    expect(config.apiPrefix).toBe("/sandbox")
  })

  it("reads default image from env", () => {
    process.env.III_DEFAULT_IMAGE = "ubuntu:22.04"
    const config = loadConfig()
    expect(config.defaultImage).toBe("ubuntu:22.04")
  })

  it("defaults image to python:3.12-slim", () => {
    delete process.env.III_DEFAULT_IMAGE
    const config = loadConfig()
    expect(config.defaultImage).toBe("python:3.12-slim")
  })

  it("reads engine url from env", () => {
    process.env.III_ENGINE_URL = "ws://remote:9999"
    const config = loadConfig()
    expect(config.engineUrl).toBe("ws://remote:9999")
  })

  it("reads worker name from env", () => {
    process.env.III_WORKER_NAME = "custom-worker"
    const config = loadConfig()
    expect(config.workerName).toBe("custom-worker")
  })

  it("reads workspace dir from env", () => {
    process.env.III_WORKSPACE_DIR = "/home/user/code"
    const config = loadConfig()
    expect(config.workspaceDir).toBe("/home/user/code")
  })

  it("defaults workspace dir to /workspace", () => {
    delete process.env.III_WORKSPACE_DIR
    const config = loadConfig()
    expect(config.workspaceDir).toBe("/workspace")
  })

  it("reads ttl sweep interval from env", () => {
    process.env.III_TTL_SWEEP = "*/10 * * * * *"
    const config = loadConfig()
    expect(config.ttlSweepInterval).toBe("*/10 * * * * *")
  })

  it("reads metrics interval from env", () => {
    process.env.III_METRICS_INTERVAL = "*/120 * * * * *"
    const config = loadConfig()
    expect(config.metricsInterval).toBe("*/120 * * * * *")
  })

  it("returns all expected keys", () => {
    const config = loadConfig()
    const keys = Object.keys(config).sort()
    expect(keys).toEqual([
      "allowedImages",
      "apiPrefix",
      "authToken",
      "defaultCpu",
      "defaultImage",
      "defaultMemory",
      "defaultTimeout",
      "engineUrl",
      "maxCommandTimeout",
      "maxSandboxes",
      "metricsInterval",
      "restPort",
      "ttlSweepInterval",
      "workerName",
      "workspaceDir",
    ])
  })
})
