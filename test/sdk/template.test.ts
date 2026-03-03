import { describe, it, expect, vi, afterEach } from "vitest";

describe("SDK template exports", () => {
  it("exports listTemplates function", async () => {
    const sdk = await import("../../packages/sdk/src/index.js");
    expect(typeof sdk.listTemplates).toBe("function");
  });

  it("exports SandboxTemplate type via types", async () => {
    const types = await import("../../packages/sdk/src/types.js");
    expect(types).toBeDefined();
  });
});

describe("listTemplates", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches template list", async () => {
    const templates = [
      { id: "tpl_python-data-science", name: "python-data-science", builtin: true },
      { id: "tpl_node-web", name: "node-web", builtin: true },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ templates }),
    });

    const { listTemplates } = await import("../../packages/sdk/src/index.js");
    const result = await listTemplates({ baseUrl: "http://localhost:3111" });

    expect(result).toEqual(templates);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3111/sandbox/templates",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("uses default base URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ templates: [] }),
    });

    const { listTemplates } = await import("../../packages/sdk/src/index.js");
    await listTemplates();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3111/sandbox/templates",
      expect.any(Object),
    );
  });

  it("passes auth token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ templates: [] }),
    });

    const { listTemplates } = await import("../../packages/sdk/src/index.js");
    await listTemplates({ baseUrl: "http://localhost:3111", token: "secret" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3111/sandbox/templates",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const { listTemplates } = await import("../../packages/sdk/src/index.js");
    await expect(
      listTemplates({ baseUrl: "http://localhost:3111" }),
    ).rejects.toThrow("GET /sandbox/templates failed");
  });
});

describe("createSandbox with template", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes template field in request body", async () => {
    const sandboxInfo = {
      id: "sbx_tpl",
      name: "sbx_tpl",
      image: "node:20-slim",
      status: "running",
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sandboxInfo),
    });

    const { createSandbox } = await import("../../packages/sdk/src/index.js");
    await createSandbox({ template: "node-web" });

    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.template).toBe("node-web");
  });
});
