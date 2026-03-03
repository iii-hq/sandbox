import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import {
  execInContainer,
  getDocker,
  copyToContainer,
} from "../docker/client.js";
import { getLanguageConfig } from "../interpreter/languages.js";
import type { Sandbox, CodeResult, KernelSpec } from "../types.js";

export function registerInterpreterFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "interp::execute", description: "Run code in a sandbox" },
    async (input: {
      id: string;
      code: string;
      language?: string;
    }): Promise<CodeResult> => {
      const ctx = getContext();
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      const lang = getLanguageConfig(input.language ?? "python");
      const container = getDocker().getContainer(`iii-sbx-${input.id}`);

      const filename = `/tmp/code${lang.fileExtension}`;
      await copyToContainer(
        container,
        filename,
        Buffer.from(input.code, "utf-8"),
      );

      const execCmd = getExecCommand(input.language ?? "python", filename);
      const start = Date.now();
      const result = await execInContainer(
        container,
        execCmd,
        config.maxCommandTimeout * 1000,
      );

      ctx.logger.info("Code executed", {
        id: input.id,
        language: input.language,
      });
      return {
        output: result.stdout,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        executionTime: Date.now() - start,
      };
    },
  );

  sdk.registerFunction(
    { id: "interp::install", description: "Install packages in sandbox" },
    async (input: {
      id: string;
      packages: string[];
      manager?: string;
    }): Promise<{ output: string }> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      const lang = getLanguageConfig(input.manager ?? "python");
      const container = getDocker().getContainer(`iii-sbx-${input.id}`);
      const cmd = lang.installCommand(input.packages);
      const result = await execInContainer(container, cmd, 120000);

      if (result.exitCode !== 0)
        throw new Error(`Install failed: ${result.stderr}`);
      return { output: result.stdout };
    },
  );

  sdk.registerFunction(
    { id: "interp::kernels", description: "List available languages/kernels" },
    async (): Promise<KernelSpec[]> => {
      return [
        { name: "python3", language: "python", displayName: "Python 3" },
        { name: "node", language: "javascript", displayName: "Node.js" },
        { name: "bash", language: "bash", displayName: "Bash" },
        { name: "go", language: "go", displayName: "Go" },
      ];
    },
  );
}

function getExecCommand(language: string, filename: string): string[] {
  switch (language.toLowerCase()) {
    case "python":
      return ["python3", filename];
    case "javascript":
      return ["node", filename];
    case "typescript":
      return ["npx", "tsx", filename];
    case "go":
      return ["go", "run", filename];
    case "bash":
      return ["bash", filename];
    default:
      return ["python3", filename];
  }
}
