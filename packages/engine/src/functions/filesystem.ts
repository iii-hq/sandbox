import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import {
  execInContainer,
  getDocker,
  copyToContainer,
  copyFromContainer,
  listContainerDir,
  searchInContainer,
  getFileInfo,
} from "../docker/client.js";
import {
  validatePath,
  validateChmodMode,
  validateSearchPattern,
} from "../security/validate.js";
import type { Sandbox, FileInfo, FileMetadata } from "../types.js";

export function registerFilesystemFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  const getContainer = async (id: string) => {
    const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, id);
    if (!sandbox) throw new Error(`Sandbox not found: ${id}`);
    if (sandbox.status !== "running")
      throw new Error(`Sandbox not running: ${sandbox.status}`);
    return getDocker().getContainer(`iii-sbx-${id}`);
  };

  sdk.registerFunction(
    { id: "fs::read", description: "Read a file from sandbox" },
    async (input: { id: string; path: string }): Promise<string> => {
      validatePath(input.path, config.workspaceDir);
      const container = await getContainer(input.id);
      const result = await execInContainer(
        container,
        ["cat", input.path],
        10000,
      );
      if (result.exitCode !== 0)
        throw new Error(`Failed to read: ${result.stderr}`);
      return result.stdout;
    },
  );

  sdk.registerFunction(
    { id: "fs::write", description: "Write a file to sandbox" },
    async (input: {
      id: string;
      path: string;
      content: string;
    }): Promise<{ success: boolean }> => {
      validatePath(input.path, config.workspaceDir);
      const container = await getContainer(input.id);
      await copyToContainer(
        container,
        input.path,
        Buffer.from(input.content, "utf-8"),
      );
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "fs::delete", description: "Delete a file from sandbox" },
    async (input: {
      id: string;
      path: string;
    }): Promise<{ success: boolean }> => {
      validatePath(input.path, config.workspaceDir);
      const container = await getContainer(input.id);
      const result = await execInContainer(
        container,
        ["rm", "-f", input.path],
        10000,
      );
      if (result.exitCode !== 0)
        throw new Error(`Failed to delete: ${result.stderr}`);
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "fs::list", description: "List directory contents" },
    async (input: { id: string; path?: string }): Promise<FileInfo[]> => {
      const dir = input.path ?? config.workspaceDir;
      validatePath(dir, config.workspaceDir);
      const container = await getContainer(input.id);
      return listContainerDir(container, dir);
    },
  );

  sdk.registerFunction(
    { id: "fs::search", description: "Search files by pattern" },
    async (input: {
      id: string;
      pattern: string;
      dir?: string;
    }): Promise<string[]> => {
      const dir = input.dir ?? config.workspaceDir;
      validatePath(dir, config.workspaceDir);
      validateSearchPattern(input.pattern);
      const container = await getContainer(input.id);
      return searchInContainer(container, dir, input.pattern);
    },
  );

  sdk.registerFunction(
    { id: "fs::upload", description: "Upload file (base64)" },
    async (input: {
      id: string;
      path: string;
      content: string;
    }): Promise<{ success: boolean }> => {
      validatePath(input.path, config.workspaceDir);
      const container = await getContainer(input.id);
      await copyToContainer(
        container,
        input.path,
        Buffer.from(input.content, "base64"),
      );
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "fs::download", description: "Download file (base64)" },
    async (input: { id: string; path: string }): Promise<string> => {
      validatePath(input.path, config.workspaceDir);
      const container = await getContainer(input.id);
      const buf = await copyFromContainer(container, input.path);
      return buf.toString("base64");
    },
  );

  sdk.registerFunction(
    { id: "fs::info", description: "Get file metadata" },
    async (input: { id: string; paths: string[] }): Promise<FileMetadata[]> => {
      for (const p of input.paths) validatePath(p, config.workspaceDir);
      const container = await getContainer(input.id);
      return getFileInfo(container, input.paths);
    },
  );

  sdk.registerFunction(
    { id: "fs::move", description: "Move/rename files" },
    async (input: {
      id: string;
      moves: Array<{ from: string; to: string }>;
    }): Promise<{ success: boolean }> => {
      const container = await getContainer(input.id);
      for (const { from, to } of input.moves) {
        validatePath(from, config.workspaceDir);
        validatePath(to, config.workspaceDir);
        const result = await execInContainer(
          container,
          ["mv", from, to],
          10000,
        );
        if (result.exitCode !== 0)
          throw new Error(`Move failed: ${result.stderr}`);
      }
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "fs::mkdir", description: "Create directories" },
    async (input: {
      id: string;
      paths: string[];
    }): Promise<{ success: boolean }> => {
      const container = await getContainer(input.id);
      for (const p of input.paths) {
        validatePath(p, config.workspaceDir);
        const result = await execInContainer(
          container,
          ["mkdir", "-p", p],
          10000,
        );
        if (result.exitCode !== 0)
          throw new Error(`Mkdir failed: ${result.stderr}`);
      }
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "fs::rmdir", description: "Remove directories" },
    async (input: {
      id: string;
      paths: string[];
    }): Promise<{ success: boolean }> => {
      const container = await getContainer(input.id);
      for (const p of input.paths) {
        validatePath(p, config.workspaceDir);
        const result = await execInContainer(
          container,
          ["rm", "-rf", p],
          10000,
        );
        if (result.exitCode !== 0)
          throw new Error(`Rmdir failed: ${result.stderr}`);
      }
      return { success: true };
    },
  );

  sdk.registerFunction(
    { id: "fs::chmod", description: "Change file permissions" },
    async (input: {
      id: string;
      path: string;
      mode: string;
    }): Promise<{ success: boolean }> => {
      validatePath(input.path, config.workspaceDir);
      validateChmodMode(input.mode);
      const container = await getContainer(input.id);
      const result = await execInContainer(
        container,
        ["chmod", input.mode, input.path],
        10000,
      );
      if (result.exitCode !== 0)
        throw new Error(`Chmod failed: ${result.stderr}`);
      return { success: true };
    },
  );
}
