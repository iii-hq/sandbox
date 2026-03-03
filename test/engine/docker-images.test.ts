import { describe, it, expect, vi, beforeEach } from "vitest"

const mockImage = {
  inspect: vi.fn(),
}

const mockDocker = {
  pull: vi.fn(),
  getImage: vi.fn().mockReturnValue(mockImage),
  modem: { followProgress: vi.fn() },
}

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => mockDocker,
}))

import { pullImage, imageExists, ensureImage } from "../../packages/engine/src/docker/images.js"

describe("Docker Images", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocker.getImage.mockReturnValue(mockImage)
  })

  describe("pullImage", () => {
    it("calls docker.pull and follows progress", async () => {
      mockDocker.pull.mockImplementation((name: string, cb: Function) => {
        const stream = { on: vi.fn() }
        cb(null, stream)
      })
      mockDocker.modem.followProgress.mockImplementation((_stream: any, cb: Function) => {
        cb(null)
      })

      await pullImage("python:3.12-slim")

      expect(mockDocker.pull).toHaveBeenCalledWith("python:3.12-slim", expect.any(Function))
      expect(mockDocker.modem.followProgress).toHaveBeenCalled()
    })

    it("handles pull error", async () => {
      mockDocker.pull.mockImplementation((_name: string, cb: Function) => {
        cb(new Error("pull failed"), null)
      })

      await expect(pullImage("bad-image")).rejects.toThrow("pull failed")
    })

    it("handles progress error", async () => {
      mockDocker.pull.mockImplementation((_name: string, cb: Function) => {
        const stream = { on: vi.fn() }
        cb(null, stream)
      })
      mockDocker.modem.followProgress.mockImplementation((_stream: any, cb: Function) => {
        cb(new Error("download failed"))
      })

      await expect(pullImage("broken:latest")).rejects.toThrow("download failed")
    })
  })

  describe("imageExists", () => {
    it("returns true when image exists", async () => {
      mockImage.inspect.mockResolvedValue({ Id: "sha256:abc" })

      const result = await imageExists("python:3.12-slim")

      expect(result).toBe(true)
      expect(mockDocker.getImage).toHaveBeenCalledWith("python:3.12-slim")
    })

    it("returns false when inspect throws", async () => {
      mockImage.inspect.mockRejectedValue(new Error("no such image"))

      const result = await imageExists("nonexistent:latest")

      expect(result).toBe(false)
    })
  })

  describe("ensureImage", () => {
    it("does not pull if image already exists", async () => {
      mockImage.inspect.mockResolvedValue({ Id: "sha256:abc" })

      await ensureImage("python:3.12-slim")

      expect(mockDocker.pull).not.toHaveBeenCalled()
    })

    it("pulls if image is missing", async () => {
      mockImage.inspect.mockRejectedValue(new Error("no such image"))
      mockDocker.pull.mockImplementation((_name: string, cb: Function) => {
        const stream = { on: vi.fn() }
        cb(null, stream)
      })
      mockDocker.modem.followProgress.mockImplementation((_stream: any, cb: Function) => {
        cb(null)
      })

      await ensureImage("node:20")

      expect(mockDocker.pull).toHaveBeenCalledWith("node:20", expect.any(Function))
    })
  })
})
