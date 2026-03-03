import cac from "cac";
import { createSandbox, getSandbox, listSandboxes } from "@iii-sandbox/sdk";
import { readFileSync } from "node:fs";

//#region src/commands/create.ts
async function createCommand(image, opts, config) {
	const sbx = await createSandbox({
		image,
		...opts,
		baseUrl: config.baseUrl,
		token: config.token
	});
	console.log(`Created sandbox: ${sbx.id}`);
	console.log(`  Image: ${sbx.info.image}`);
	console.log(`  Status: ${sbx.info.status}`);
	console.log(`  Expires: ${new Date(sbx.info.expiresAt).toISOString()}`);
	return sbx;
}

//#endregion
//#region src/commands/exec.ts
async function execCommand(sandboxId, command, opts, config) {
	const sbx = await getSandbox(sandboxId, config);
	if (opts.stream) {
		const stream = await sbx.execStream(command);
		for await (const chunk of stream) {
			if (chunk.type === "stdout") process.stdout.write(chunk.data);
			if (chunk.type === "stderr") process.stderr.write(chunk.data);
		}
		return;
	}
	const result = await sbx.exec(command, opts.timeout);
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.exitCode !== 0) process.exit(result.exitCode);
}

//#endregion
//#region src/commands/run.ts
async function runCommand(sandboxId, code, opts, config) {
	const result = await (await getSandbox(sandboxId, config)).interpreter.run(code, opts.language ?? "python");
	if (result.output) console.log(result.output);
	if (result.error) console.error(result.error);
}

//#endregion
//#region src/commands/list.ts
async function listCommand(config) {
	const sandboxes = await listSandboxes(config);
	if (sandboxes.length === 0) {
		console.log("No active sandboxes");
		return;
	}
	console.log(`${"ID".padEnd(32)} ${"IMAGE".padEnd(25)} ${"STATUS".padEnd(10)} EXPIRES`);
	for (const s of sandboxes) {
		const expires = new Date(s.expiresAt).toLocaleTimeString();
		console.log(`${s.id.padEnd(32)} ${s.image.padEnd(25)} ${s.status.padEnd(10)} ${expires}`);
	}
}

//#endregion
//#region src/commands/kill.ts
async function killCommand(sandboxId, config) {
	await (await getSandbox(sandboxId, config)).kill();
	console.log(`Killed sandbox: ${sandboxId}`);
}

//#endregion
//#region src/commands/logs.ts
async function logsCommand(sandboxId, config) {
	const result = await (await getSandbox(sandboxId, config)).exec("cat /var/log/*.log 2>/dev/null || echo 'No logs found'");
	console.log(result.stdout);
}

//#endregion
//#region src/commands/file.ts
async function fileReadCommand(sandboxId, path, config) {
	const content = await (await getSandbox(sandboxId, config)).filesystem.read(path);
	process.stdout.write(content);
}
async function fileWriteCommand(sandboxId, path, content, config) {
	await (await getSandbox(sandboxId, config)).filesystem.write(path, content);
	console.log(`Written: ${path}`);
}
async function fileUploadCommand(sandboxId, localPath, remotePath, config) {
	const sbx = await getSandbox(sandboxId, config);
	const data = readFileSync(localPath);
	await sbx.filesystem.upload(remotePath, data.toString("base64"));
	console.log(`Uploaded: ${localPath} -> ${remotePath}`);
}
async function fileListCommand(sandboxId, path, config) {
	const files = await (await getSandbox(sandboxId, config)).filesystem.list(path);
	for (const f of files) {
		const type = f.isDirectory ? "d" : "-";
		console.log(`${type} ${f.size.toString().padStart(10)} ${f.name}`);
	}
}

//#endregion
//#region src/commands/serve.ts
async function serveCommand(opts) {
	const { execSync } = await import("node:child_process");
	const port = opts.port ?? 3111;
	console.log(`Starting iii-sandbox engine on port ${port}...`);
	execSync(`III_REST_PORT=${port} tsx ${new URL("../../engine/src/index.ts", import.meta.url).pathname}`, {
		stdio: "inherit",
		env: {
			...process.env,
			III_REST_PORT: String(port)
		}
	});
}

//#endregion
//#region src/index.ts
const cli = cac("iii-sandbox");
function getConfig() {
	return {
		baseUrl: process.env.III_SANDBOX_URL ?? "http://localhost:3111",
		token: process.env.III_SANDBOX_TOKEN
	};
}
cli.command("create [image]", "Create a new sandbox").option("--name <name>", "Sandbox name").option("--timeout <seconds>", "TTL in seconds").option("--memory <mb>", "Memory limit in MB").option("--network", "Enable networking").action(async (image = "python:3.12-slim", opts) => {
	await createCommand(image, opts, getConfig());
});
cli.command("exec <sandboxId> <command>", "Execute a command").option("--timeout <seconds>", "Command timeout").option("--stream", "Stream output").action(async (sandboxId, command, opts) => {
	await execCommand(sandboxId, command, opts, getConfig());
});
cli.command("run <sandboxId> <code>", "Run code").option("--language <lang>", "Language (python|javascript|go|bash)").action(async (sandboxId, code, opts) => {
	await runCommand(sandboxId, code, opts, getConfig());
});
cli.command("list", "List active sandboxes").action(async () => {
	await listCommand(getConfig());
});
cli.command("kill <sandboxId>", "Kill a sandbox").action(async (sandboxId) => {
	await killCommand(sandboxId, getConfig());
});
cli.command("logs <sandboxId>", "View sandbox logs").action(async (sandboxId) => {
	await logsCommand(sandboxId, getConfig());
});
cli.command("file read <sandboxId> <path>", "Read a file").action(async (sandboxId, path) => {
	await fileReadCommand(sandboxId, path, getConfig());
});
cli.command("file write <sandboxId> <path> <content>", "Write a file").action(async (sandboxId, path, content) => {
	await fileWriteCommand(sandboxId, path, content, getConfig());
});
cli.command("file upload <sandboxId> <local> <remote>", "Upload a file").action(async (sandboxId, local, remote) => {
	await fileUploadCommand(sandboxId, local, remote, getConfig());
});
cli.command("file ls <sandboxId> [path]", "List files").action(async (sandboxId, path = "/workspace") => {
	await fileListCommand(sandboxId, path, getConfig());
});
cli.command("serve", "Start the engine worker").option("--port <port>", "REST API port").action(async (opts) => {
	await serveCommand(opts);
});
cli.help();
cli.version("0.1.0");
cli.parse();

//#endregion
export {  };
//# sourceMappingURL=index.js.map