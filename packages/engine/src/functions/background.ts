import Docker from "dockerode";
import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { execInContainer, getDocker } from "../docker/client.js";
import { validateCommand } from "../security/validate.js";
import type { Sandbox, BackgroundExec } from "../types.js";

const BG_SCOPE = "background";

export function registerBackgroundFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "cmd::background", description: "Run command in background" },
    async (input: { id: string; command: string }): Promise<BackgroundExec> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      if (sandbox.status !== "running")
        throw new Error(`Sandbox not running: ${sandbox.status}`);

      const execId = generateId("bg");
      const shellCmd = `(${input.command}) > /tmp/${execId}.log 2>&1`;
      const cmd = validateCommand(shellCmd);
      const container = getDocker().getContainer(`iii-sbx-${input.id}`);

      const exec = await container.exec({
        Cmd: cmd,
        AttachStdout: false,
        AttachStderr: false,
        Detach: true,
      } as Docker.ExecCreateOptions);
      await (exec as unknown as Docker.Exec).start({ Detach: true } as any);

      const bg: BackgroundExec = {
        id: execId,
        sandboxId: input.id,
        command: input.command,
        running: true,
        startedAt: Date.now(),
      };
      await kv.set(BG_SCOPE, execId, bg);
      return bg;
    },
  );

  sdk.registerFunction(
    {
      id: "cmd::background-status",
      description: "Get background command status",
    },
    async (input: { id: string }): Promise<BackgroundExec> => {
      const bg = await kv.get<BackgroundExec>(BG_SCOPE, input.id);
      if (!bg) throw new Error(`Background exec not found: ${input.id}`);
      return bg;
    },
  );

  sdk.registerFunction(
    {
      id: "cmd::background-logs",
      description: "Get background command logs",
    },
    async (input: {
      id: string;
      cursor?: number;
    }): Promise<{ output: string; cursor: number }> => {
      const bg = await kv.get<BackgroundExec>(BG_SCOPE, input.id);
      if (!bg) throw new Error(`Background exec not found: ${input.id}`);

      const container = getDocker().getContainer(`iii-sbx-${bg.sandboxId}`);
      const logFile = `/tmp/${input.id}.log`;
      const skip = input.cursor ?? 0;
      const result = await execInContainer(
        container,
        ["sh", "-c", `tail -c +${skip + 1} ${logFile} 2>/dev/null || echo ""`],
        10000,
      );
      return {
        output: result.stdout,
        cursor: skip + Buffer.byteLength(result.stdout),
      };
    },
  );

  sdk.registerFunction(
    { id: "cmd::interrupt", description: "Interrupt a running command" },
    async (input: {
      id: string;
      pid?: number;
    }): Promise<{ success: boolean }> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      if (input.pid) {
        await execInContainer(
          container,
          ["kill", "-SIGINT", String(input.pid)],
          5000,
        );
      } else {
        await execInContainer(
          container,
          ["pkill", "-SIGINT", "-f", "sh -c"],
          5000,
        );
      }
      return { success: true };
    },
  );
}
