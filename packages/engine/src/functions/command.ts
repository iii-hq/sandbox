import { getContext, http } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import {
  execInContainer,
  execStreamInContainer,
  getDocker,
} from "../docker/client.js";
import {
  validateCommand,
  validatePath,
  checkAuth,
} from "../security/validate.js";
import type { Sandbox, ExecResult } from "../types.js";

export function registerCommandFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  const getRunningContainer = async (id: string) => {
    const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, id);
    if (!sandbox) throw new Error(`Sandbox not found: ${id}`);
    if (sandbox.status !== "running")
      throw new Error(`Sandbox is not running: ${sandbox.status}`);
    return getDocker().getContainer(`iii-sbx-${id}`);
  };

  sdk.registerFunction(
    { id: "cmd::run", description: "Execute a command in a sandbox" },
    async (input: {
      id: string;
      command: string;
      timeout?: number;
      cwd?: string;
    }): Promise<ExecResult> => {
      const ctx = getContext();
      let command = input.command;
      if (input.cwd) {
        validatePath(input.cwd, config.workspaceDir);
        command = `cd "${input.cwd}" && ${command}`;
      }
      const cmd = validateCommand(command);
      const timeoutMs = Math.min(
        (input.timeout ?? config.maxCommandTimeout) * 1000,
        config.maxCommandTimeout * 1000,
      );

      ctx.logger.info("Executing command", {
        id: input.id,
        command: input.command,
      });
      const container = await getRunningContainer(input.id);
      return execInContainer(container, cmd, timeoutMs);
    },
  );

  sdk.registerFunction(
    {
      id: "cmd::run-stream",
      description: "Execute a command with streaming output",
    },
    http(async (req, res) => {
      const authErr = checkAuth(req as any, config);
      if (authErr) {
        res.status(authErr.status_code);
        res.stream.write(JSON.stringify(authErr.body));
        res.close();
        return;
      }

      const id = req.path_params?.id;
      const body = req.body as { command: string; timeout?: number };
      const ctx = getContext();

      let cmd: string[];
      try {
        cmd = validateCommand(body.command);
      } catch (err: any) {
        res.status(400);
        res.stream.write(JSON.stringify({ error: err.message }));
        res.close();
        return;
      }

      const timeoutMs = Math.min(
        (body.timeout ?? config.maxCommandTimeout) * 1000,
        config.maxCommandTimeout * 1000,
      );

      let container;
      try {
        container = await getRunningContainer(id);
      } catch (err: any) {
        const msg = err.message ?? "Internal error";
        const code = msg.includes("not found") ? 404 : 400;
        res.status(code);
        res.stream.write(JSON.stringify({ error: msg }));
        res.close();
        return;
      }

      ctx.logger.info("Streaming command", { id, command: body.command });

      res.status(200);
      res.headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        await execStreamInContainer(container, cmd, timeoutMs, (chunk) => {
          res.stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });
      } catch {
        // timeout already sent exit chunk via onChunk
      }

      res.close();
    }),
  );
}
