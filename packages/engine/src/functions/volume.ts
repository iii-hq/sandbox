import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { getDocker } from "../docker/client.js";
import type { Sandbox, SandboxVolume } from "../types.js";

export function registerVolumeFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "volume::create", description: "Create a persistent volume" },
    async (input: { name: string; driver?: string }): Promise<SandboxVolume> => {
      const ctx = getContext();
      const volumeId = generateId("vol");
      const dockerVolumeName = `iii-vol-${volumeId}`;

      await getDocker().createVolume({
        Name: dockerVolumeName,
        Driver: input.driver ?? "local",
      });

      const volume: SandboxVolume = {
        id: volumeId,
        name: input.name,
        dockerVolumeName,
        createdAt: Date.now(),
      };

      await kv.set(SCOPES.VOLUMES, volumeId, volume);
      ctx.logger.info("Volume created", { volumeId, name: input.name });
      return volume;
    },
  );

  sdk.registerFunction(
    { id: "volume::list", description: "List all volumes" },
    async (): Promise<{ volumes: SandboxVolume[] }> => {
      const volumes = await kv.list<SandboxVolume>(SCOPES.VOLUMES);
      return { volumes };
    },
  );

  sdk.registerFunction(
    { id: "volume::delete", description: "Delete a volume" },
    async (input: { volumeId: string }): Promise<{ deleted: string }> => {
      const ctx = getContext();
      const volume = await kv.get<SandboxVolume>(SCOPES.VOLUMES, input.volumeId);
      if (!volume) throw new Error(`Volume not found: ${input.volumeId}`);

      try {
        await getDocker().getVolume(volume.dockerVolumeName).remove();
      } catch {
        ctx.logger.warn("Docker volume already removed", {
          volumeId: input.volumeId,
        });
      }

      await kv.delete(SCOPES.VOLUMES, input.volumeId);
      ctx.logger.info("Volume deleted", { volumeId: input.volumeId });
      return { deleted: input.volumeId };
    },
  );

  sdk.registerFunction(
    { id: "volume::attach", description: "Attach a volume to a sandbox" },
    async (input: {
      volumeId: string;
      sandboxId: string;
      mountPath: string;
    }): Promise<{ attached: boolean; mountPath: string }> => {
      const ctx = getContext();
      const volume = await kv.get<SandboxVolume>(SCOPES.VOLUMES, input.volumeId);
      if (!volume) throw new Error(`Volume not found: ${input.volumeId}`);

      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.sandboxId);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.sandboxId}`);

      volume.sandboxId = input.sandboxId;
      volume.mountPath = input.mountPath;
      await kv.set(SCOPES.VOLUMES, input.volumeId, volume);

      ctx.logger.info("Volume attached", {
        volumeId: input.volumeId,
        sandboxId: input.sandboxId,
        mountPath: input.mountPath,
      });
      return { attached: true, mountPath: input.mountPath };
    },
  );

  sdk.registerFunction(
    { id: "volume::detach", description: "Detach a volume from a sandbox" },
    async (input: { volumeId: string }): Promise<{ detached: boolean }> => {
      const ctx = getContext();
      const volume = await kv.get<SandboxVolume>(SCOPES.VOLUMES, input.volumeId);
      if (!volume) throw new Error(`Volume not found: ${input.volumeId}`);

      volume.sandboxId = undefined;
      volume.mountPath = undefined;
      await kv.set(SCOPES.VOLUMES, input.volumeId, volume);

      ctx.logger.info("Volume detached", { volumeId: input.volumeId });
      return { detached: true };
    },
  );
}
