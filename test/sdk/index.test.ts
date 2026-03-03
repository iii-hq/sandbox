import { describe, it, expect, vi, afterEach } from "vitest"

describe("SDK index exports", () => {
  it("exports createSandbox function", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(typeof sdk.createSandbox).toBe("function")
  })

  it("exports listSandboxes function", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(typeof sdk.listSandboxes).toBe("function")
  })

  it("exports getSandbox function", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(typeof sdk.getSandbox).toBe("function")
  })

  it("exports Sandbox class", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(sdk.Sandbox).toBeDefined()
  })

  it("exports FileSystem class", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(sdk.FileSystem).toBeDefined()
  })

  it("exports CodeInterpreter class", async () => {
    const sdk = await import("../../packages/sdk/src/index.js")
    expect(sdk.CodeInterpreter).toBeDefined()
  })
})

describe("createSandbox", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("uses default base URL and image", async () => {
    const sandboxInfo = {
      id: "sbx_new",
      name: "sbx_new",
      image: "python:3.12-slim",
      status: "running",
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sandboxInfo),
    })

    const { createSandbox } = await import("../../packages/sdk/src/index.js")
    const sbx = await createSandbox()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3111/sandbox/sandboxes",
      expect.objectContaining({ method: "POST" }),
    )
    expect(sbx.id).toBe("sbx_new")
  })

  it("uses custom base URL and token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "sbx_1", name: "test", image: "node:20", status: "running", createdAt: 1, expiresAt: 2 }),
    })

    const { createSandbox } = await import("../../packages/sdk/src/index.js")
    await createSandbox({ baseUrl: "http://custom:9999", token: "secret", image: "node:20" })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://custom:9999/sandbox/sandboxes",
      expect.objectContaining({
        headers: expect.objectContaining({ "Authorization": "Bearer secret" }),
      }),
    )
  })
})

describe("listSandboxes", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("fetches sandbox list", async () => {
    const list = [{ id: "sbx_1" }, { id: "sbx_2" }]
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(list) })

    const { listSandboxes } = await import("../../packages/sdk/src/index.js")
    const result = await listSandboxes({ baseUrl: "http://localhost:3111" })

    expect(result).toEqual(list)
  })
})

describe("getSandbox", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("fetches single sandbox by ID", async () => {
    const info = { id: "sbx_123", name: "test", image: "python:3.12", status: "running", createdAt: 1, expiresAt: 2 }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(info) })

    const { getSandbox } = await import("../../packages/sdk/src/index.js")
    const sbx = await getSandbox("sbx_123", { baseUrl: "http://localhost:3111" })

    expect(sbx.id).toBe("sbx_123")
  })
})
