import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import { execInContainer, getDocker } from "../docker/client.js";
import type { Sandbox } from "../types.js";

export function registerEnvFunctions(
  sdk: any,
  kv: StateKV,
  _config: EngineConfig,
) {
  const getRunningContainer = async (id: string) => {
    const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, id);
    if (!sandbox) throw new Error(`Sandbox not found: ${id}`);
    if (sandbox.status !== "running")
      throw new Error(`Sandbox is not running: ${sandbox.status}`);
    return getDocker().getContainer(`iii-sbx-${id}`);
  };

  sdk.registerFunction(
    { id: "env::get", description: "Get an environment variable from a sandbox" },
    async (input: { id: string; key: string }) => {
      const ctx = getContext();
      ctx.logger.info("Getting env var", { id: input.id, key: input.key });
      const container = await getRunningContainer(input.id);
      const result = await execInContainer(
        container,
        ["sh", "-c", `printenv "${input.key}"`],
        10000,
      );
      if (result.exitCode !== 0)
        return { key: input.key, value: null, exists: false };
      return { key: input.key, value: result.stdout.trimEnd(), exists: true };
    },
  );

  sdk.registerFunction(
    { id: "env::set", description: "Set environment variables in a sandbox" },
    async (input: { id: string; vars: Record<string, string> }) => {
      const ctx = getContext();
      ctx.logger.info("Setting env vars", {
        id: input.id,
        keys: Object.keys(input.vars),
      });
      if (!input.vars || Object.keys(input.vars).length === 0)
        throw new Error("No variables provided");

      const container = await getRunningContainer(input.id);

      const envLines = Object.entries(input.vars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

      await execInContainer(
        container,
        [
          "sh",
          "-c",
          `printf '%s\\n' '${envLines.replace(/'/g, "'\\''")}' >> /etc/environment`,
        ],
        10000,
      );

      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (sandbox) {
        const currentEnv = sandbox.metadata?.env
          ? JSON.parse(sandbox.metadata.env)
          : {};
        const updatedEnv = { ...currentEnv, ...input.vars };
        sandbox.metadata = {
          ...sandbox.metadata,
          env: JSON.stringify(updatedEnv),
        };
        await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
      }

      return { set: Object.keys(input.vars), count: Object.keys(input.vars).length };
    },
  );

  sdk.registerFunction(
    {
      id: "env::list",
      description: "List all environment variables in a sandbox",
    },
    async (input: { id: string }) => {
      const ctx = getContext();
      ctx.logger.info("Listing env vars", { id: input.id });
      const container = await getRunningContainer(input.id);
      const result = await execInContainer(container, ["sh", "-c", "env"], 10000);
      if (result.exitCode !== 0)
        throw new Error(`Failed to list env: ${result.stderr}`);

      const vars: Record<string, string> = {};
      result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          const eqIdx = line.indexOf("=");
          if (eqIdx > 0) {
            vars[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
          }
        });
      return { vars, count: Object.keys(vars).length };
    },
  );

  sdk.registerFunction(
    {
      id: "env::delete",
      description: "Delete an environment variable from a sandbox",
    },
    async (input: { id: string; key: string }) => {
      const ctx = getContext();
      ctx.logger.info("Deleting env var", { id: input.id, key: input.key });
      const container = await getRunningContainer(input.id);

      await execInContainer(
        container,
        ["sh", "-c", `sed -i '/^${input.key}=/d' /etc/environment`],
        10000,
      );

      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (sandbox?.metadata?.env) {
        const currentEnv = JSON.parse(sandbox.metadata.env);
        delete currentEnv[input.key];
        sandbox.metadata.env = JSON.stringify(currentEnv);
        await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
      }

      return { deleted: input.key };
    },
  );
}
