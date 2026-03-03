import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { createContainer, getDocker } from "../docker/client.js";
import { ensureImage } from "../docker/images.js";
import {
  validateSandboxConfig,
  validateImageAllowed,
} from "../security/validate.js";
import type {
  Sandbox,
  SandboxConfig,
  SandboxTemplate,
  ListOptions,
  PaginatedResult,
} from "../types.js";

export function registerSandboxFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "sandbox::create", description: "Create a new sandbox container" },
    async (input: unknown): Promise<Sandbox> => {
      const ctx = getContext();
      const raw = input as Record<string, unknown>;

      let merged = raw;
      if (raw.template) {
        const templates = await kv.list<SandboxTemplate>(SCOPES.TEMPLATES);
        const tpl = templates.find(
          (t) => t.name === raw.template || t.id === raw.template,
        );
        if (!tpl) throw new Error(`Template not found: ${raw.template}`);
        const { template: _, ...overrides } = raw;
        merged = { ...tpl.config, ...overrides };
      }

      const cfg = validateSandboxConfig(merged);

      if (!validateImageAllowed(cfg.image, config.allowedImages)) {
        throw new Error(`Image not allowed: ${cfg.image}`);
      }

      const sandboxes = await kv.list<Sandbox>(SCOPES.SANDBOXES);
      if (sandboxes.length >= config.maxSandboxes) {
        throw new Error(
          `Maximum sandbox limit reached: ${config.maxSandboxes}`,
        );
      }

      const id = generateId();
      const now = Date.now();
      const timeout = cfg.timeout ?? config.defaultTimeout;

      const fullConfig: SandboxConfig = {
        ...cfg,
        memory: cfg.memory ?? config.defaultMemory,
        cpu: cfg.cpu ?? config.defaultCpu,
        workdir: cfg.workdir ?? config.workspaceDir,
      };

      ctx.logger.info("Creating sandbox", { id, image: cfg.image });
      await ensureImage(cfg.image);
      await createContainer(id, fullConfig, cfg.entrypoint);

      const sandbox: Sandbox = {
        id,
        name: cfg.name ?? id,
        image: cfg.image,
        status: "running",
        createdAt: now,
        expiresAt: now + timeout * 1000,
        config: fullConfig,
        metadata: cfg.metadata ?? {},
        entrypoint: cfg.entrypoint,
      };

      await kv.set(SCOPES.SANDBOXES, id, sandbox);
      ctx.logger.info("Sandbox created", { id });
      return sandbox;
    },
  );

  sdk.registerFunction(
    { id: "sandbox::get", description: "Get sandbox by ID" },
    async (input: { id: string }): Promise<Sandbox> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      return sandbox;
    },
  );

  sdk.registerFunction(
    { id: "sandbox::list", description: "List sandboxes with filtering" },
    async (input: ListOptions): Promise<PaginatedResult<Sandbox>> => {
      let sandboxes = await kv.list<Sandbox>(SCOPES.SANDBOXES);
      if (input?.status) {
        sandboxes = sandboxes.filter((s) => s.status === input.status);
      }
      if (input?.metadata) {
        sandboxes = sandboxes.filter((s) =>
          Object.entries(input.metadata!).every(
            ([k, v]) => s.metadata?.[k] === v,
          ),
        );
      }
      const total = sandboxes.length;
      const page = input?.page ?? 1;
      const pageSize = Math.min(Math.max(input?.pageSize ?? 20, 1), 200);
      const start = (page - 1) * pageSize;
      return {
        items: sandboxes.slice(start, start + pageSize),
        total,
        page,
        pageSize,
      };
    },
  );

  sdk.registerFunction(
    { id: "sandbox::renew", description: "Renew sandbox expiration" },
    async (input: { id: string; expiresAt: number }): Promise<Sandbox> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      const minExpiry = Date.now() + 60000;
      const maxExpiry = Date.now() + 86400000;
      sandbox.expiresAt = Math.min(
        Math.max(input.expiresAt, minExpiry),
        maxExpiry,
      );
      await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
      return sandbox;
    },
  );

  sdk.registerFunction(
    { id: "sandbox::kill", description: "Kill and remove a sandbox" },
    async (input: { id: string }): Promise<{ success: boolean }> => {
      const ctx = getContext();
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      try {
        const container = getDocker().getContainer(`iii-sbx-${input.id}`);
        await container.stop().catch(() => {});
        await container.remove({ force: true });
      } catch {
        ctx.logger.warn("Container already removed", { id: input.id });
      }

      await kv.delete(SCOPES.SANDBOXES, input.id);
      ctx.logger.info("Sandbox killed", { id: input.id });
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "sandbox::pause", description: "Pause a running sandbox" },
    async (input: { id: string }): Promise<Sandbox> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      if (sandbox.status !== "running")
        throw new Error(`Sandbox is not running: ${sandbox.status}`);

      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      try {
        await container.pause();
      } catch (err: any) {
        throw new Error(`Failed to pause sandbox: ${err.message}`);
      }

      sandbox.status = "paused";
      await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
      return sandbox;
    },
  );

  sdk.registerFunction(
    { id: "sandbox::resume", description: "Resume a paused sandbox" },
    async (input: { id: string }): Promise<Sandbox> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      if (sandbox.status !== "paused")
        throw new Error(`Sandbox is not paused: ${sandbox.status}`);

      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      try {
        await container.unpause();
      } catch (err: any) {
        throw new Error(`Failed to resume sandbox: ${err.message}`);
      }

      sandbox.status = "running";
      await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
      return sandbox;
    },
  );
}
