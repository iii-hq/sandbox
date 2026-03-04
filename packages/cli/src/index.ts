import cac from "cac";
import type { ClientConfig } from "@iii-sandbox/sdk";
import { createCommand } from "./commands/create.js";
import { execCommand } from "./commands/exec.js";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { killCommand } from "./commands/kill.js";
import { logsCommand } from "./commands/logs.js";
import {
  fileReadCommand,
  fileWriteCommand,
  fileUploadCommand,
  fileListCommand,
} from "./commands/file.js";
import { serveCommand } from "./commands/serve.js";

const cli = cac("iii-sandbox");

function getConfig(): ClientConfig {
  return {
    baseUrl: process.env.III_SANDBOX_URL ?? "http://localhost:3111",
    token: process.env.III_SANDBOX_TOKEN,
  };
}

cli
  .command("create [image]", "Create a new sandbox")
  .option("--name <name>", "Sandbox name")
  .option("--timeout <seconds>", "TTL in seconds")
  .option("--memory <mb>", "Memory limit in MB")
  .option("--network", "Enable networking")
  .action(async (image = "python:3.12-slim", opts) => {
    await createCommand(image, opts, getConfig());
  });

cli
  .command("exec <sandboxId> <command>", "Execute a command")
  .option("--timeout <seconds>", "Command timeout")
  .option("--stream", "Stream output")
  .action(async (sandboxId, command, opts) => {
    await execCommand(sandboxId, command, opts, getConfig());
  });

cli
  .command("run <sandboxId> <code>", "Run code")
  .option(
    "--language <lang>",
    "Language (python|javascript|typescript|go|bash)",
  )
  .action(async (sandboxId, code, opts) => {
    await runCommand(sandboxId, code, opts, getConfig());
  });

cli.command("list", "List active sandboxes").action(async () => {
  await listCommand(getConfig());
});

cli.command("kill <sandboxId>", "Kill a sandbox").action(async (sandboxId) => {
  await killCommand(sandboxId, getConfig());
});

cli
  .command("logs <sandboxId>", "View sandbox logs")
  .action(async (sandboxId) => {
    await logsCommand(sandboxId, getConfig());
  });

cli
  .command("file read <sandboxId> <path>", "Read a file")
  .action(async (sandboxId, path) => {
    await fileReadCommand(sandboxId, path, getConfig());
  });

cli
  .command("file write <sandboxId> <path> <content>", "Write a file")
  .action(async (sandboxId, path, content) => {
    await fileWriteCommand(sandboxId, path, content, getConfig());
  });

cli
  .command("file upload <sandboxId> <local> <remote>", "Upload a file")
  .action(async (sandboxId, local, remote) => {
    await fileUploadCommand(sandboxId, local, remote, getConfig());
  });

cli
  .command("file ls <sandboxId> [path]", "List files")
  .action(async (sandboxId, path = "/workspace") => {
    await fileListCommand(sandboxId, path, getConfig());
  });

cli
  .command("serve", "Start the engine worker")
  .option("--port <port>", "REST API port")
  .action(async (opts) => {
    await serveCommand(opts);
  });

cli.help();
cli.version("0.1.0");

cli.parse();
