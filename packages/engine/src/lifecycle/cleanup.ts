import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import { SCOPES } from "../state/schema.js";
import { getDocker } from "../docker/client.js";
import type { Sandbox } from "../types.js";

export async function cleanupAll(kv: StateKV): Promise<void> {
  const sandboxes = await kv.list<Sandbox>(SCOPES.SANDBOXES);
  const docker = getDocker();

  for (const sandbox of sandboxes) {
    try {
      const container = docker.getContainer(`iii-sbx-${sandbox.id}`);
      await container.stop().catch(() => {});
      await container.remove({ force: true });
    } catch (err: any) {
      getContext().logger.warn("Cleanup failed for container", {
        id: sandbox.id,
        error: err?.message,
      });
    }
    await kv.delete(SCOPES.SANDBOXES, sandbox.id);
  }
}
