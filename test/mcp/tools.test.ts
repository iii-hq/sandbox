import { describe, it, expect } from "vitest";
import { tools } from "../../packages/mcp/src/tools.js";

describe("MCP tools", () => {
  it("has at least 10 tools", () => {
    expect(tools.length).toBeGreaterThanOrEqual(10);
  });

  it("all tools have name, description, and inputSchema", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe("string");
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("has all expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("sandbox_create");
    expect(names).toContain("sandbox_exec");
    expect(names).toContain("sandbox_run_code");
    expect(names).toContain("sandbox_read_file");
    expect(names).toContain("sandbox_write_file");
    expect(names).toContain("sandbox_list_files");
    expect(names).toContain("sandbox_install_package");
    expect(names).toContain("sandbox_list");
    expect(names).toContain("sandbox_kill");
    expect(names).toContain("sandbox_metrics");
  });

  it("tool names are unique", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("tool names use snake_case", () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
    }
  });

  describe("sandbox_create schema", () => {
    const createTool = tools.find((t) => t.name === "sandbox_create")!;

    it("has image field with default", () => {
      const parsed = createTool.inputSchema.parse({});
      expect(parsed.image).toBe("python:3.12-slim");
    });

    it("accepts custom image", () => {
      const parsed = createTool.inputSchema.parse({ image: "node:20" });
      expect(parsed.image).toBe("node:20");
    });

    it("accepts optional name", () => {
      const parsed = createTool.inputSchema.parse({ name: "my-sandbox" });
      expect(parsed.name).toBe("my-sandbox");
    });

    it("accepts memory and network options", () => {
      const parsed = createTool.inputSchema.parse({
        memory: 1024,
        network: true,
      });
      expect(parsed.memory).toBe(1024);
      expect(parsed.network).toBe(true);
    });
  });

  describe("sandbox_exec schema", () => {
    const execTool = tools.find((t) => t.name === "sandbox_exec")!;

    it("requires sandboxId and command", () => {
      expect(() => execTool.inputSchema.parse({})).toThrow();
      expect(() => execTool.inputSchema.parse({ sandboxId: "x" })).toThrow();
    });

    it("parses valid input", () => {
      const parsed = execTool.inputSchema.parse({
        sandboxId: "sbx_1",
        command: "ls",
      });
      expect(parsed.sandboxId).toBe("sbx_1");
      expect(parsed.command).toBe("ls");
    });

    it("accepts optional timeout", () => {
      const parsed = execTool.inputSchema.parse({
        sandboxId: "sbx_1",
        command: "ls",
        timeout: 30,
      });
      expect(parsed.timeout).toBe(30);
    });
  });

  describe("sandbox_run_code schema", () => {
    const runTool = tools.find((t) => t.name === "sandbox_run_code")!;

    it("requires sandboxId and code", () => {
      expect(() => runTool.inputSchema.parse({})).toThrow();
    });

    it("defaults language to python", () => {
      const parsed = runTool.inputSchema.parse({
        sandboxId: "sbx_1",
        code: "print(1)",
      });
      expect(parsed.language).toBe("python");
    });

    it("accepts all supported languages", () => {
      for (const lang of ["python", "javascript", "typescript", "go", "bash"]) {
        const parsed = runTool.inputSchema.parse({
          sandboxId: "sbx_1",
          code: "x",
          language: lang,
        });
        expect(parsed.language).toBe(lang);
      }
    });

    it("rejects unsupported languages", () => {
      expect(() =>
        runTool.inputSchema.parse({
          sandboxId: "sbx_1",
          code: "x",
          language: "ruby",
        }),
      ).toThrow();
    });
  });

  describe("sandbox_list schema", () => {
    const listTool = tools.find((t) => t.name === "sandbox_list")!;

    it("accepts empty input", () => {
      const parsed = listTool.inputSchema.parse({});
      expect(parsed).toEqual({});
    });
  });

  describe("sandbox_kill schema", () => {
    const killTool = tools.find((t) => t.name === "sandbox_kill")!;

    it("requires sandboxId", () => {
      expect(() => killTool.inputSchema.parse({})).toThrow();
    });

    it("parses valid input", () => {
      const parsed = killTool.inputSchema.parse({ sandboxId: "sbx_123" });
      expect(parsed.sandboxId).toBe("sbx_123");
    });
  });

  describe("sandbox_install_package schema", () => {
    const installTool = tools.find(
      (t) => t.name === "sandbox_install_package",
    )!;

    it("requires sandboxId and packages", () => {
      expect(() => installTool.inputSchema.parse({})).toThrow();
    });

    it("defaults manager to pip", () => {
      const parsed = installTool.inputSchema.parse({
        sandboxId: "sbx_1",
        packages: ["numpy"],
      });
      expect(parsed.manager).toBe("pip");
    });

    it("accepts npm manager", () => {
      const parsed = installTool.inputSchema.parse({
        sandboxId: "sbx_1",
        packages: ["lodash"],
        manager: "npm",
      });
      expect(parsed.manager).toBe("npm");
    });

    it("accepts array of packages", () => {
      const parsed = installTool.inputSchema.parse({
        sandboxId: "sbx_1",
        packages: ["a", "b", "c"],
      });
      expect(parsed.packages).toEqual(["a", "b", "c"]);
    });
  });

  describe("sandbox_read_file schema", () => {
    const readTool = tools.find((t) => t.name === "sandbox_read_file")!;

    it("requires sandboxId and path", () => {
      expect(() => readTool.inputSchema.parse({})).toThrow();
      expect(() =>
        readTool.inputSchema.parse({ sandboxId: "sbx_1" }),
      ).toThrow();
    });

    it("parses valid input", () => {
      const parsed = readTool.inputSchema.parse({
        sandboxId: "sbx_1",
        path: "/workspace/main.py",
      });
      expect(parsed.path).toBe("/workspace/main.py");
    });
  });

  describe("sandbox_write_file schema", () => {
    const writeTool = tools.find((t) => t.name === "sandbox_write_file")!;

    it("requires all three fields", () => {
      expect(() =>
        writeTool.inputSchema.parse({ sandboxId: "sbx_1", path: "/a" }),
      ).toThrow();
    });

    it("parses valid input", () => {
      const parsed = writeTool.inputSchema.parse({
        sandboxId: "sbx_1",
        path: "/a.py",
        content: "x=1",
      });
      expect(parsed.content).toBe("x=1");
    });
  });

  describe("sandbox_list_files schema", () => {
    const listTool = tools.find((t) => t.name === "sandbox_list_files")!;

    it("defaults path to /workspace", () => {
      const parsed = listTool.inputSchema.parse({ sandboxId: "sbx_1" });
      expect(parsed.path).toBe("/workspace");
    });

    it("accepts custom path", () => {
      const parsed = listTool.inputSchema.parse({
        sandboxId: "sbx_1",
        path: "/tmp",
      });
      expect(parsed.path).toBe("/tmp");
    });
  });

  describe("sandbox_metrics schema", () => {
    const metricsTool = tools.find((t) => t.name === "sandbox_metrics")!;

    it("requires sandboxId", () => {
      expect(() => metricsTool.inputSchema.parse({})).toThrow();
    });
  });
});
