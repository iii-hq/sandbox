import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
}));

const mockExecInContainer = vi.fn();
const mockGetDocker = vi.fn();
const mockCopyToContainer = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => mockGetDocker(),
  copyToContainer: (...args: any[]) => mockCopyToContainer(...args),
}));

import { registerInterpreterFunctions } from "../../packages/engine/src/functions/interpreter.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Interpreter Functions", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, any>;

  const config: EngineConfig = {
    apiPrefix: "/sandbox",
    maxSandboxes: 10,
    defaultTimeout: 3600,
    defaultMemory: 512,
    defaultCpu: 1,
    maxCommandTimeout: 300,
    workspaceDir: "/workspace",
    allowedImages: ["*"],
    authToken: "",
    engineUrl: "ws://localhost:49134",
    workerName: "test",
    restPort: 3111,
    maxFileSize: 10485760,
    cleanupOnExit: true,
  };

  const runningSandbox = {
    id: "sbx_test",
    name: "test",
    image: "python:3.12-slim",
    status: "running",
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: {},
    metadata: {},
  };

  beforeEach(() => {
    handlers = new Map();
    kvStore = new Map();
    kvStore.set("sbx_test", runningSandbox);

    const kv = {
      get: vi.fn(
        async (_scope: string, key: string) => kvStore.get(key) ?? null,
      ),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
    };

    mockGetDocker.mockReturnValue({
      getContainer: (name: string) => ({ id: name }),
    });

    mockExecInContainer.mockReset();
    mockCopyToContainer.mockReset();

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "output",
      stderr: "",
      duration: 50,
    });

    mockCopyToContainer.mockResolvedValue(undefined);

    registerInterpreterFunctions(sdk, kv as any, config);
  });

  describe("interp::execute", () => {
    it("executes python code by default", async () => {
      const execute = handlers.get("interp::execute")!;
      const result = await execute({ id: "sbx_test", code: "print('hello')" });

      expect(result.output).toBe("output");
      expect(result.error).toBeUndefined();
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("writes code to file via copyToContainer with correct extension", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "print(1)", language: "python" });

      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/code.py",
        Buffer.from("print(1)", "utf-8"),
      );
    });

    it("uses .js extension for javascript", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({
        id: "sbx_test",
        code: "console.log(1)",
        language: "javascript",
      });

      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/code.js",
        Buffer.from("console.log(1)", "utf-8"),
      );
    });

    it("uses .ts extension for typescript", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({
        id: "sbx_test",
        code: "const x: number = 1",
        language: "typescript",
      });

      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/code.ts",
        Buffer.from("const x: number = 1", "utf-8"),
      );
    });

    it("uses .go extension for go", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "package main", language: "go" });

      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/code.go",
        Buffer.from("package main", "utf-8"),
      );
    });

    it("uses .sh extension for bash", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "echo hi", language: "bash" });

      expect(mockCopyToContainer).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/code.sh",
        Buffer.from("echo hi", "utf-8"),
      );
    });

    it("throws when file write fails", async () => {
      mockCopyToContainer.mockRejectedValueOnce(new Error("write error"));

      const execute = handlers.get("interp::execute")!;
      await expect(
        execute({ id: "sbx_test", code: "print(1)" }),
      ).rejects.toThrow("write error");
    });

    it("returns stderr when execution fails", async () => {
      mockExecInContainer.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "NameError: x",
        duration: 20,
      });

      const execute = handlers.get("interp::execute")!;
      const result = await execute({ id: "sbx_test", code: "print(x)" });

      expect(result.error).toBe("NameError: x");
    });

    it("uses python3 exec command for python", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "print(1)", language: "python" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["python3", "/tmp/code.py"],
        300000,
      );
    });

    it("uses node exec command for javascript", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({
        id: "sbx_test",
        code: "console.log(1)",
        language: "javascript",
      });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["node", "/tmp/code.js"],
        300000,
      );
    });

    it("uses npx tsx exec command for typescript", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({
        id: "sbx_test",
        code: "const x = 1",
        language: "typescript",
      });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["npx", "tsx", "/tmp/code.ts"],
        300000,
      );
    });

    it("uses go run exec command for go", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "package main", language: "go" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["go", "run", "/tmp/code.go"],
        300000,
      );
    });

    it("uses bash exec command for bash", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "echo hi", language: "bash" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["bash", "/tmp/code.sh"],
        300000,
      );
    });

    it("defaults to python3 for unknown language", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "print(1)" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["python3", "/tmp/code.py"],
        300000,
      );
    });

    it("uses maxCommandTimeout * 1000 for exec timeout", async () => {
      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "print(1)" });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        300000,
      );
    });

    it("gets container with iii-sbx- prefix", async () => {
      const getContainerSpy = vi
        .fn()
        .mockReturnValue({ id: "iii-sbx-sbx_test" });
      mockGetDocker.mockReturnValue({ getContainer: getContainerSpy });

      const execute = handlers.get("interp::execute")!;
      await execute({ id: "sbx_test", code: "print(1)" });

      expect(getContainerSpy).toHaveBeenCalledWith("iii-sbx-sbx_test");
    });

    it("throws for non-existent sandbox", async () => {
      const execute = handlers.get("interp::execute")!;
      await expect(
        execute({ id: "sbx_missing", code: "print(1)" }),
      ).rejects.toThrow("Sandbox not found: sbx_missing");
    });
  });

  describe("interp::install", () => {
    it("installs packages with pip by default", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "Successfully installed numpy",
        stderr: "",
        duration: 5000,
      });

      const install = handlers.get("interp::install")!;
      const result = await install({ id: "sbx_test", packages: ["numpy"] });

      expect(result.output).toBe("Successfully installed numpy");
      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["pip", "install", "numpy"],
        120000,
      );
    });

    it("installs multiple packages", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "installed",
        stderr: "",
        duration: 5000,
      });

      const install = handlers.get("interp::install")!;
      await install({ id: "sbx_test", packages: ["numpy", "pandas", "scipy"] });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["pip", "install", "numpy", "pandas", "scipy"],
        120000,
      );
    });

    it("installs with npm manager", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "added 1 package",
        stderr: "",
        duration: 3000,
      });

      const install = handlers.get("interp::install")!;
      await install({
        id: "sbx_test",
        packages: ["lodash"],
        manager: "javascript",
      });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["npm", "install", "-g", "lodash"],
        120000,
      );
    });

    it("installs with go manager", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "go: added module",
        stderr: "",
        duration: 3000,
      });

      const install = handlers.get("interp::install")!;
      await install({
        id: "sbx_test",
        packages: ["github.com/gin-gonic/gin"],
        manager: "go",
      });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["go", "install", "github.com/gin-gonic/gin"],
        120000,
      );
    });

    it("installs with bash/apt-get manager", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "installed curl",
        stderr: "",
        duration: 3000,
      });

      const install = handlers.get("interp::install")!;
      await install({
        id: "sbx_test",
        packages: ["curl", "wget"],
        manager: "bash",
      });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        ["apt-get", "install", "-y", "curl", "wget"],
        120000,
      );
    });

    it("throws on install failure", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "No matching distribution",
        duration: 2000,
      });

      const install = handlers.get("interp::install")!;
      await expect(
        install({ id: "sbx_test", packages: ["nonexistent-pkg"] }),
      ).rejects.toThrow("Install failed: No matching distribution");
    });

    it("uses 120000ms timeout for installs", async () => {
      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        duration: 1000,
      });

      const install = handlers.get("interp::install")!;
      await install({ id: "sbx_test", packages: ["numpy"] });

      expect(mockExecInContainer).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        120000,
      );
    });

    it("throws for non-existent sandbox", async () => {
      const install = handlers.get("interp::install")!;
      await expect(
        install({ id: "sbx_missing", packages: ["numpy"] }),
      ).rejects.toThrow("Sandbox not found: sbx_missing");
    });
  });

  describe("interp::kernels", () => {
    it("returns 4 kernel specs", async () => {
      const kernels = handlers.get("interp::kernels")!;
      const result = await kernels();

      expect(result).toHaveLength(4);
    });

    it("includes python3 kernel", async () => {
      const kernels = handlers.get("interp::kernels")!;
      const result = await kernels();

      expect(result).toContainEqual({
        name: "python3",
        language: "python",
        displayName: "Python 3",
      });
    });

    it("includes node kernel", async () => {
      const kernels = handlers.get("interp::kernels")!;
      const result = await kernels();

      expect(result).toContainEqual({
        name: "node",
        language: "javascript",
        displayName: "Node.js",
      });
    });

    it("includes bash kernel", async () => {
      const kernels = handlers.get("interp::kernels")!;
      const result = await kernels();

      expect(result).toContainEqual({
        name: "bash",
        language: "bash",
        displayName: "Bash",
      });
    });

    it("includes go kernel", async () => {
      const kernels = handlers.get("interp::kernels")!;
      const result = await kernels();

      expect(result).toContainEqual({
        name: "go",
        language: "go",
        displayName: "Go",
      });
    });

    it("all kernels have name, language, and displayName", async () => {
      const kernels = handlers.get("interp::kernels")!;
      const result = await kernels();

      for (const kernel of result) {
        expect(kernel.name).toBeTruthy();
        expect(kernel.language).toBeTruthy();
        expect(kernel.displayName).toBeTruthy();
      }
    });
  });

  describe("registration", () => {
    it("registers all 3 functions", () => {
      expect(handlers.has("interp::execute")).toBe(true);
      expect(handlers.has("interp::install")).toBe(true);
      expect(handlers.has("interp::kernels")).toBe(true);
      expect(handlers.size).toBe(3);
    });
  });
});
