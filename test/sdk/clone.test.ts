import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../../packages/sdk/src/sandbox.js";
import { HttpClient } from "../../packages/sdk/src/client.js";

describe("Sandbox.clone", () => {
  let mockClient: HttpClient;
  const info = {
    id: "sbx_test123",
    name: "test",
    image: "python:3.12-slim",
    status: "running" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      stream: vi.fn(),
    } as unknown as HttpClient;
  });

  it("calls correct endpoint", async () => {
    const clonedInfo = { ...info, id: "sbx_cloned456", name: "sbx_cloned456" };
    (mockClient.post as any).mockResolvedValue(clonedInfo);
    const sbx = new Sandbox(mockClient, info);

    const result = await sbx.clone();

    expect(mockClient.post).toHaveBeenCalledWith(
      "/sandbox/sandboxes/sbx_test123/clone",
      { name: undefined },
    );
    expect(result.id).toBe("sbx_cloned456");
  });

  it("passes name when provided", async () => {
    const clonedInfo = { ...info, id: "sbx_cloned789", name: "my-clone" };
    (mockClient.post as any).mockResolvedValue(clonedInfo);
    const sbx = new Sandbox(mockClient, info);

    const result = await sbx.clone("my-clone");

    expect(mockClient.post).toHaveBeenCalledWith(
      "/sandbox/sandboxes/sbx_test123/clone",
      { name: "my-clone" },
    );
    expect(result.name).toBe("my-clone");
  });

  it("returns SandboxInfo for the cloned sandbox", async () => {
    const clonedInfo = {
      id: "sbx_new",
      name: "cloned",
      image: "sha256:committed",
      status: "running" as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
    (mockClient.post as any).mockResolvedValue(clonedInfo);
    const sbx = new Sandbox(mockClient, info);

    const result = await sbx.clone();

    expect(result).toEqual(clonedInfo);
  });

  it("propagates errors from client", async () => {
    (mockClient.post as any).mockRejectedValue(new Error("POST failed: 404"));
    const sbx = new Sandbox(mockClient, info);

    await expect(sbx.clone()).rejects.toThrow("POST failed: 404");
  });
});
