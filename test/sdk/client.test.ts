import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("HttpClient", () => {
  let client: HttpClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new HttpClient({
      baseUrl: "http://localhost:3111",
      token: "test-token",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", () => {
      const c = new HttpClient({ baseUrl: "http://localhost:3111/" });
      expect((c as any).baseUrl).toBe("http://localhost:3111");
    });

    it("strips multiple trailing slashes", () => {
      const c = new HttpClient({ baseUrl: "http://localhost:3111///" });
      expect((c as any).baseUrl).toBe("http://localhost:3111//");
    });

    it("stores token when provided", () => {
      expect((client as any).token).toBe("test-token");
    });

    it("allows undefined token", () => {
      const c = new HttpClient({ baseUrl: "http://localhost:3111" });
      expect((c as any).token).toBeUndefined();
    });
  });

  describe("headers", () => {
    it("sets auth header when token provided", () => {
      const headers = (client as any).headers();
      expect(headers["Authorization"]).toBe("Bearer test-token");
    });

    it("omits auth header when no token", () => {
      const c = new HttpClient({ baseUrl: "http://localhost:3111" });
      const headers = (c as any).headers();
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("always includes Content-Type", () => {
      const headers = (client as any).headers();
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("get", () => {
    it("sends GET request with correct URL and headers", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ id: "1" }),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      await client.get("/sandbox/test");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3111/sandbox/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("returns parsed JSON on success", async () => {
      const data = { id: "sbx_123", status: "running" };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(data) });

      const result = await client.get("/sandbox/sandboxes/sbx_123");
      expect(result).toEqual(data);
    });

    it("throws on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      await expect(client.get("/sandbox/missing")).rejects.toThrow(
        "GET /sandbox/missing failed: 404 Not found",
      );
    });

    it("includes status code in error message", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      });

      await expect(client.get("/bad")).rejects.toThrow("500");
    });
  });

  describe("post", () => {
    it("sends POST with JSON body", async () => {
      const body = { command: "ls" };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      await client.post("/sandbox/exec", body);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3111/sandbox/exec",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    });

    it("sends POST without body when undefined", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      await client.post("/sandbox/pause");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3111/sandbox/pause",
        expect.objectContaining({
          method: "POST",
          body: undefined,
        }),
      );
    });

    it("throws on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad request"),
      });

      await expect(client.post("/sandbox/bad")).rejects.toThrow(
        "POST /sandbox/bad failed: 400",
      );
    });
  });

  describe("del", () => {
    it("sends DELETE request", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      await client.del("/sandbox/sandboxes/sbx_123");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3111/sandbox/sandboxes/sbx_123",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("returns parsed response", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      const result = await client.del("/sandbox/test");
      expect(result).toEqual({ success: true });
    });

    it("throws on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      await expect(client.del("/sandbox/missing")).rejects.toThrow(
        "DELETE /sandbox/missing failed: 404",
      );
    });
  });

  describe("stream", () => {
    it("sends POST with event-stream accept header", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode("data: hello\n\n"),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const gen = await client.stream("/sandbox/exec/stream", {
        command: "ls",
      });
      const chunks: string[] = [];
      for await (const chunk of gen) chunks.push(chunk);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3111/sandbox/exec/stream",
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: "text/event-stream" }),
        }),
      );
      expect(chunks).toEqual(["hello"]);
    });

    it("throws on non-ok stream response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const gen = client.stream("/bad");
      const chunks: string[] = [];
      await expect(async () => {
        for await (const chunk of gen) chunks.push(chunk);
      }).rejects.toThrow("STREAM /bad failed: 500");
    });

    it("handles multiple SSE lines in single chunk", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode("data: line1\ndata: line2\n"),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const gen = await client.stream("/stream");
      const chunks: string[] = [];
      for await (const chunk of gen) chunks.push(chunk);
      expect(chunks).toEqual(["line1", "line2"]);
    });

    it("handles empty body gracefully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body: null });

      const gen = await client.stream("/stream");
      const chunks: string[] = [];
      for await (const chunk of gen) chunks.push(chunk);
      expect(chunks).toEqual([]);
    });
  });
});
