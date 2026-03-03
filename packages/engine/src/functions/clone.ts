import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { createContainer, getDocker } from "../docker/client.js";
import type { Sandbox } from "../types.js";

export function registerCloneFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "sandbox::clone", description: "Clone a sandbox with all its state" },
    async (input: { id: string; name?: string }): Promise<Sandbox> => {
      const ctx = getContext();
      const source = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!source) throw new Error(`Sandbox not found: ${input.id}`);
      if (source.status === "stopped")
        throw new Error(`Sandbox is stopped: ${input.id}`);

      const newId = generateId();
      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      const commitResult = await container.commit({
        repo: `iii-sbx-clone-${newId}`,
      });

      const clonedConfig = { ...source.config, image: commitResult.Id };
      await createContainer(newId, clonedConfig, source.entrypoint);

      const now = Date.now();
      const timeout = source.config.timeout ?? config.defaultTimeout;

      const clone: Sandbox = {
        id: newId,
        name: input.name ?? newId,
        image: commitResult.Id,
        status: "running",
        createdAt: now,
        expiresAt: now + timeout * 1000,
        config: clonedConfig,
        metadata: { ...source.metadata },
        entrypoint: source.entrypoint,
      };

      await kv.set(SCOPES.SANDBOXES, newId, clone);
      ctx.logger.info("Sandbox cloned", {
        sourceId: input.id,
        cloneId: newId,
      });
      return clone;
    },
  );
}
