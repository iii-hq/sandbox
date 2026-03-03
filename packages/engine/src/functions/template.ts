import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import type { SandboxTemplate } from "../types.js";

const BUILTIN_TEMPLATES: SandboxTemplate[] = [
  {
    id: "tpl_python-data-science",
    name: "python-data-science",
    description: "Python with NumPy, Pandas, Matplotlib",
    config: { image: "python:3.12-slim", memory: 1024, timeout: 7200, env: { PYTHONUNBUFFERED: "1" } },
    builtin: true,
    createdAt: 0,
  },
  {
    id: "tpl_node-web",
    name: "node-web",
    description: "Node.js web development environment",
    config: { image: "node:20-slim", memory: 512, timeout: 3600, network: true },
    builtin: true,
    createdAt: 0,
  },
  {
    id: "tpl_go-api",
    name: "go-api",
    description: "Go API development environment",
    config: { image: "golang:1.22-alpine", memory: 512, timeout: 3600, network: true },
    builtin: true,
    createdAt: 0,
  },
  {
    id: "tpl_rust-cli",
    name: "rust-cli",
    description: "Rust CLI development environment",
    config: { image: "rust:1.77-slim", memory: 1024, timeout: 7200 },
    builtin: true,
    createdAt: 0,
  },
];

export function registerTemplateFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  for (const tpl of BUILTIN_TEMPLATES) {
    kv.get<SandboxTemplate>(SCOPES.TEMPLATES, tpl.id).then((existing) => {
      if (!existing) kv.set(SCOPES.TEMPLATES, tpl.id, tpl);
    });
  }

  sdk.registerFunction(
    { id: "template::create", description: "Create a sandbox template" },
    async (input: { name: string; description: string; config: Record<string, unknown> }): Promise<SandboxTemplate> => {
      if (!input.name || !input.config) {
        throw new Error("Template requires name and config");
      }

      const existing = await kv.list<SandboxTemplate>(SCOPES.TEMPLATES);
      if (existing.some((t) => t.name === input.name)) {
        throw new Error(`Template with name already exists: ${input.name}`);
      }

      const id = generateId("tpl");
      const template: SandboxTemplate = {
        id,
        name: input.name,
        description: input.description ?? "",
        config: input.config as any,
        builtin: false,
        createdAt: Date.now(),
      };

      await kv.set(SCOPES.TEMPLATES, id, template);
      return template;
    },
  );

  sdk.registerFunction(
    { id: "template::list", description: "List all sandbox templates" },
    async (): Promise<{ templates: SandboxTemplate[] }> => {
      const templates = await kv.list<SandboxTemplate>(SCOPES.TEMPLATES);
      return { templates };
    },
  );

  sdk.registerFunction(
    { id: "template::get", description: "Get a sandbox template by ID or name" },
    async (input: { id?: string; name?: string }): Promise<SandboxTemplate> => {
      if (input.id) {
        const tpl = await kv.get<SandboxTemplate>(SCOPES.TEMPLATES, input.id);
        if (!tpl) throw new Error(`Template not found: ${input.id}`);
        return tpl;
      }

      if (input.name) {
        const all = await kv.list<SandboxTemplate>(SCOPES.TEMPLATES);
        const tpl = all.find((t) => t.name === input.name);
        if (!tpl) throw new Error(`Template not found: ${input.name}`);
        return tpl;
      }

      throw new Error("Provide id or name to get a template");
    },
  );

  sdk.registerFunction(
    { id: "template::delete", description: "Delete a sandbox template" },
    async (input: { id: string }): Promise<{ deleted: string }> => {
      const tpl = await kv.get<SandboxTemplate>(SCOPES.TEMPLATES, input.id);
      if (!tpl) throw new Error(`Template not found: ${input.id}`);
      if (tpl.builtin) throw new Error("Cannot delete builtin template");

      await kv.delete(SCOPES.TEMPLATES, input.id);
      return { deleted: input.id };
    },
  );
}
