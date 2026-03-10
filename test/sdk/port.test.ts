import { describe, it, expect, vi, beforeEach } from "vitest"
import { PortManager } from "../../packages/sdk/src/port.js"
import { HttpClient } from "../../packages/sdk/src/client.js"

describe("PortManager", () => {
  let mockClient: HttpClient
  let ports: PortManager

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
      getBaseUrl: vi.fn().mockReturnValue("http://localhost:3111"),
    } as unknown as HttpClient
    ports = new PortManager(mockClient, "sbx_test")
  })

  describe("expose", () => {
    it("calls correct endpoint with containerPort", async () => {
      const mapping = { containerPort: 8080, hostPort: 8080, protocol: "tcp", state: "mapped" }
      ;(mockClient.post as any).mockResolvedValue(mapping)
      const result = await ports.expose(8080)

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/ports",
        { containerPort: 8080, hostPort: undefined, protocol: undefined },
      )
      expect(result).toEqual(mapping)
    })

    it("passes hostPort and protocol when provided", async () => {
      const mapping = { containerPort: 3000, hostPort: 9000, protocol: "udp", state: "mapped" }
      ;(mockClient.post as any).mockResolvedValue(mapping)
      const result = await ports.expose(3000, 9000, "udp")

      expect(mockClient.post).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/ports",
        { containerPort: 3000, hostPort: 9000, protocol: "udp" },
      )
      expect(result).toEqual(mapping)
    })
  })

  describe("list", () => {
    it("calls correct endpoint and returns ports", async () => {
      const mockPorts = {
        ports: [
          { containerPort: 80, hostPort: 80, protocol: "tcp", state: "active" },
        ],
      }
      ;(mockClient.get as any).mockResolvedValue(mockPorts)
      const result = await ports.list()

      expect(mockClient.get).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/ports",
      )
      expect(result.ports).toHaveLength(1)
      expect(result.ports[0].containerPort).toBe(80)
    })

    it("returns empty array when no ports", async () => {
      ;(mockClient.get as any).mockResolvedValue({ ports: [] })
      const result = await ports.list()

      expect(result.ports).toEqual([])
    })
  })

  describe("unexpose", () => {
    it("calls correct endpoint with containerPort", async () => {
      ;(mockClient.del as any).mockResolvedValue({ removed: 8080 })
      const result = await ports.unexpose(8080)

      expect(mockClient.del).toHaveBeenCalledWith(
        "/sandbox/sandboxes/sbx_test/ports?containerPort=8080",
      )
      expect(result).toEqual({ removed: 8080 })
    })
  })

  describe("getProxyUrl", () => {
    it("returns proxy URL for a given port", () => {
      const url = ports.getProxyUrl(3000)
      expect(url).toBe("http://localhost:3111/sandbox/proxy/sbx_test/3000")
    })

    it("returns different URL for different port", () => {
      const url = ports.getProxyUrl(8080)
      expect(url).toBe("http://localhost:3111/sandbox/proxy/sbx_test/8080")
    })
  })
})
