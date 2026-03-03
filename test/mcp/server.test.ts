import { describe, it, expect } from "vitest"
import { createMcpServer } from "../../packages/mcp/src/server.js"

describe("MCP Server", () => {
  it("creates a server instance", () => {
    const server = createMcpServer({ baseUrl: "http://localhost:3111" })
    expect(server).toBeDefined()
  })

  it("accepts custom config", () => {
    const server = createMcpServer({
      baseUrl: "http://custom:9999",
      token: "test-token",
    })
    expect(server).toBeDefined()
  })

  it("works without config (uses defaults)", () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
  })
})
