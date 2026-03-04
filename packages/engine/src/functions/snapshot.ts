import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { createContainer, getDocker } from "../docker/client.js";
import type { Sandbox, Snapshot } from "../types.js";

export function registerSnapshotFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "snapshot::create", description: "Create a snapshot of a sandbox" },
    async (input: { id: string; name?: string }): Promise<Snapshot> => {
      const ctx = getContext();
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      if (sandbox.status === "stopped")
        throw new Error(`Sandbox is stopped: ${input.id}`);

      const snapshotId = generateId("snap");
      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      const commitResult = await container.commit({
        repo: `iii-sbx-snap-${snapshotId}`,
        comment: input.name ?? snapshotId,
      });

      const image = getDocker().getImage(commitResult.Id);
      const inspect = await image.inspect();

      const snapshot: Snapshot = {
        id: snapshotId,
        sandboxId: input.id,
        name: input.name ?? snapshotId,
        imageId: commitResult.Id,
        size: inspect.Size ?? 0,
        createdAt: Date.now(),
      };

      await kv.set(SCOPES.SNAPSHOTS, snapshotId, snapshot);
      ctx.logger.info("Snapshot created", { snapshotId, sandboxId: input.id });
      return snapshot;
    },
  );

  sdk.registerFunction(
    { id: "snapshot::restore", description: "Restore a sandbox from a snapshot" },
    async (input: { id: string; snapshotId: string }): Promise<Sandbox> => {
      const ctx = getContext();
      const snapshot = await kv.get<Snapshot>(SCOPES.SNAPSHOTS, input.snapshotId);
      if (!snapshot) throw new Error(`Snapshot not found: ${input.snapshotId}`);

      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      await container.stop().catch(() => {});
      await container.remove({ force: true });

      const restoredConfig = { ...sandbox.config, image: snapshot.imageId };
      await createContainer(input.id, restoredConfig, sandbox.entrypoint);

      sandbox.status = "running";
      sandbox.image = snapshot.imageId;
      await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
      ctx.logger.info("Sandbox restored from snapshot", {
        sandboxId: input.id,
        snapshotId: input.snapshotId,
      });
      return sandbox;
    },
  );

  sdk.registerFunction(
    { id: "snapshot::list", description: "List snapshots for a sandbox" },
    async (input: { id: string }): Promise<{ snapshots: Snapshot[] }> => {
      const all = await kv.list<Snapshot>(SCOPES.SNAPSHOTS);
      const snapshots = all.filter((s) => s.sandboxId === input.id);
      return { snapshots };
    },
  );

  sdk.registerFunction(
    { id: "snapshot::delete", description: "Delete a snapshot" },
    async (input: { snapshotId: string }): Promise<{ deleted: string }> => {
      const ctx = getContext();
      const snapshot = await kv.get<Snapshot>(SCOPES.SNAPSHOTS, input.snapshotId);
      if (!snapshot) throw new Error(`Snapshot not found: ${input.snapshotId}`);

      try {
        const image = getDocker().getImage(snapshot.imageId);
        await image.remove();
      } catch {
        ctx.logger.warn("Snapshot image already removed", {
          snapshotId: input.snapshotId,
        });
      }

      await kv.delete(SCOPES.SNAPSHOTS, input.snapshotId);
      ctx.logger.info("Snapshot deleted", { snapshotId: input.snapshotId });
      return { deleted: input.snapshotId };
    },
  );
}
