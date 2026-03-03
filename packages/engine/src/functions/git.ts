import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import { execInContainer, getDocker } from "../docker/client.js";
import type { Sandbox, ExecResult } from "../types.js";

export function registerGitFunctions(
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

  const gitExec = async (
    id: string,
    gitCmd: string,
    path?: string,
  ): Promise<ExecResult> => {
    const container = await getRunningContainer(id);
    const dir = path ?? "/workspace";
    const fullCmd = `cd "${dir}" && ${gitCmd}`;
    return execInContainer(container, ["sh", "-c", fullCmd], 30000);
  };

  sdk.registerFunction(
    { id: "git::clone", description: "Clone a git repository" },
    async (input: {
      id: string;
      url: string;
      path?: string;
      branch?: string;
      depth?: number;
    }): Promise<ExecResult> => {
      const ctx = getContext();
      ctx.logger.info("git clone", { id: input.id, url: input.url });
      const container = await getRunningContainer(input.id);
      let cmd = `git clone`;
      if (input.branch) cmd += ` --branch "${input.branch}"`;
      if (input.depth) cmd += ` --depth ${input.depth}`;
      cmd += ` "${input.url}"`;
      if (input.path) cmd += ` "${input.path}"`;
      return execInContainer(container, ["sh", "-c", cmd], 30000);
    },
  );

  sdk.registerFunction(
    { id: "git::status", description: "Get git status" },
    async (input: {
      id: string;
      path?: string;
    }): Promise<{
      branch: string;
      clean: boolean;
      files: { path: string; status: string }[];
    }> => {
      const ctx = getContext();
      ctx.logger.info("git status", { id: input.id });
      const branchResult = await gitExec(
        input.id,
        "git rev-parse --abbrev-ref HEAD",
        input.path,
      );
      const branch = branchResult.stdout.trim() || "HEAD";
      const result = await gitExec(
        input.id,
        "git status --porcelain",
        input.path,
      );
      const lines = result.stdout.split("\n").filter((l) => l.length >= 4);
      const files = lines.map((line) => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3),
      }));
      return { branch, clean: files.length === 0, files };
    },
  );

  sdk.registerFunction(
    { id: "git::commit", description: "Create a git commit" },
    async (input: {
      id: string;
      message: string;
      path?: string;
      all?: boolean;
    }): Promise<ExecResult> => {
      const ctx = getContext();
      ctx.logger.info("git commit", { id: input.id });
      const escaped = input.message.replace(/'/g, "'\\''");
      let cmd = "";
      if (input.all) cmd += "git add -A && ";
      cmd += `git commit -m '${escaped}'`;
      return gitExec(input.id, cmd, input.path);
    },
  );

  sdk.registerFunction(
    { id: "git::diff", description: "Show git diff" },
    async (input: {
      id: string;
      path?: string;
      staged?: boolean;
      file?: string;
    }): Promise<{ diff: string }> => {
      const ctx = getContext();
      ctx.logger.info("git diff", { id: input.id });
      let cmd = "git diff";
      if (input.staged) cmd += " --staged";
      if (input.file) cmd += ` "${input.file}"`;
      const result = await gitExec(input.id, cmd, input.path);
      return { diff: result.stdout };
    },
  );

  sdk.registerFunction(
    { id: "git::log", description: "Show git log" },
    async (input: {
      id: string;
      path?: string;
      count?: number;
    }): Promise<{
      entries: {
        hash: string;
        message: string;
        author: string;
        date: string;
      }[];
    }> => {
      const ctx = getContext();
      ctx.logger.info("git log", { id: input.id });
      const n = input.count ?? 10;
      const cmd = `git log --format="%H\t%s\t%an\t%aI" -${n}`;
      const result = await gitExec(input.id, cmd, input.path);
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      const entries = lines.map((line) => {
        const [hash, message, author, date] = line.split("\t");
        return { hash, message, author, date };
      });
      return { entries };
    },
  );

  sdk.registerFunction(
    { id: "git::branch", description: "List or create/delete branches" },
    async (input: {
      id: string;
      path?: string;
      name?: string;
      delete?: boolean;
    }): Promise<{ branches: string[]; current: string }> => {
      const ctx = getContext();
      ctx.logger.info("git branch", { id: input.id });
      if (input.name) {
        if (input.delete) {
          await gitExec(input.id, `git branch -d "${input.name}"`, input.path);
        } else {
          await gitExec(
            input.id,
            `git checkout -b "${input.name}"`,
            input.path,
          );
        }
      }
      const result = await gitExec(input.id, "git branch -a", input.path);
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      let current = "";
      const branches = lines.map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("* ")) {
          current = trimmed.substring(2);
          return current;
        }
        return trimmed;
      });
      return { branches, current };
    },
  );

  sdk.registerFunction(
    { id: "git::checkout", description: "Checkout a branch or ref" },
    async (input: {
      id: string;
      ref: string;
      path?: string;
    }): Promise<ExecResult> => {
      const ctx = getContext();
      ctx.logger.info("git checkout", { id: input.id, ref: input.ref });
      return gitExec(input.id, `git checkout "${input.ref}"`, input.path);
    },
  );

  sdk.registerFunction(
    { id: "git::push", description: "Push to remote" },
    async (input: {
      id: string;
      path?: string;
      remote?: string;
      branch?: string;
      force?: boolean;
    }): Promise<ExecResult> => {
      const ctx = getContext();
      ctx.logger.info("git push", { id: input.id });
      let cmd = "git push";
      if (input.remote) cmd += ` "${input.remote}"`;
      if (input.branch) cmd += ` "${input.branch}"`;
      if (input.force) cmd += " --force";
      return gitExec(input.id, cmd, input.path);
    },
  );

  sdk.registerFunction(
    { id: "git::pull", description: "Pull from remote" },
    async (input: {
      id: string;
      path?: string;
      remote?: string;
      branch?: string;
    }): Promise<ExecResult> => {
      const ctx = getContext();
      ctx.logger.info("git pull", { id: input.id });
      let cmd = "git pull";
      if (input.remote) cmd += ` "${input.remote}"`;
      if (input.branch) cmd += ` "${input.branch}"`;
      return gitExec(input.id, cmd, input.path);
    },
  );
}
