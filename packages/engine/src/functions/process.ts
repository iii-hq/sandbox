import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import { execInContainer, getDocker } from "../docker/client.js";
import type { Sandbox } from "../types.js";

const VALID_SIGNALS = new Set([
  "TERM",
  "KILL",
  "INT",
  "HUP",
  "USR1",
  "USR2",
  "STOP",
  "CONT",
]);

export function registerProcessFunctions(
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
    { id: "proc::list", description: "List processes in a sandbox" },
    async (input: {
      id: string;
    }): Promise<{
      processes: Array<{
        pid: number;
        user: string;
        cpu: string;
        memory: string;
        command: string;
      }>;
    }> => {
      const ctx = getContext();
      ctx.logger.info("Listing processes", { id: input.id });

      const container = await getRunningContainer(input.id);
      const top = await container.top();

      const titles = (top.Titles ?? []).map((t: string) => t.toLowerCase());
      const pidIdx = titles.indexOf("pid");
      const userIdx = titles.indexOf("user");
      const cpuIdx = titles.indexOf("%cpu");
      const memIdx = titles.indexOf("%mem");
      const cmdIdx = titles.indexOf("command");

      const processes = (top.Processes ?? []).map((row: string[]) => ({
        pid: parseInt(row[pidIdx] ?? "0", 10),
        user: row[userIdx] ?? "",
        cpu: row[cpuIdx] ?? "0.0",
        memory: row[memIdx] ?? "0.0",
        command: row[cmdIdx] ?? "",
      }));

      return { processes };
    },
  );

  sdk.registerFunction(
    { id: "proc::kill", description: "Kill a process in a sandbox" },
    async (input: {
      id: string;
      pid: number;
      signal?: string;
    }): Promise<{ killed: number; signal: string }> => {
      const ctx = getContext();
      const signal = input.signal ?? "TERM";

      if (!VALID_SIGNALS.has(signal)) {
        throw new Error(
          `Invalid signal: ${signal}. Allowed: ${[...VALID_SIGNALS].join(", ")}`,
        );
      }

      ctx.logger.info("Killing process", {
        id: input.id,
        pid: input.pid,
        signal,
      });

      const container = await getRunningContainer(input.id);
      await execInContainer(
        container,
        ["kill", `-${signal}`, String(input.pid)],
        10000,
      );

      return { killed: input.pid, signal };
    },
  );

  sdk.registerFunction(
    {
      id: "proc::top",
      description: "Get top-like resource usage per process",
    },
    async (input: {
      id: string;
    }): Promise<{
      processes: Array<{
        pid: number;
        cpu: string;
        mem: string;
        vsz: number;
        rss: number;
        command: string;
      }>;
    }> => {
      const ctx = getContext();
      ctx.logger.info("Getting process top", { id: input.id });

      const container = await getRunningContainer(input.id);
      const result = await execInContainer(
        container,
        ["sh", "-c", "ps aux --no-headers"],
        10000,
      );

      const lines = result.stdout
        .split("\n")
        .filter((l: string) => l.trim() !== "");

      const processes = lines.map((line: string) => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parseInt(parts[1] ?? "0", 10),
          cpu: parts[2] ?? "0.0",
          mem: parts[3] ?? "0.0",
          vsz: parseInt(parts[4] ?? "0", 10),
          rss: parseInt(parts[5] ?? "0", 10),
          command: parts.slice(10).join(" "),
        };
      });

      return { processes };
    },
  );
}
