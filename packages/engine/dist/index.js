import { getContext, http, init } from "iii-sdk";
import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { normalize, resolve } from "node:path";

//#region src/config.ts
function loadConfig() {
	return {
		engineUrl: process.env.III_ENGINE_URL ?? "ws://localhost:49134",
		workerName: process.env.III_WORKER_NAME ?? "iii-sandbox",
		restPort: parseInt(process.env.III_REST_PORT ?? "3111", 10),
		apiPrefix: process.env.III_API_PREFIX ?? "/sandbox",
		authToken: process.env.III_AUTH_TOKEN ?? null,
		defaultImage: process.env.III_DEFAULT_IMAGE ?? "python:3.12-slim",
		defaultTimeout: parseInt(process.env.III_DEFAULT_TIMEOUT ?? "3600", 10),
		defaultMemory: parseInt(process.env.III_DEFAULT_MEMORY ?? "512", 10),
		defaultCpu: parseInt(process.env.III_DEFAULT_CPU ?? "1", 10),
		maxSandboxes: parseInt(process.env.III_MAX_SANDBOXES ?? "50", 10),
		ttlSweepInterval: process.env.III_TTL_SWEEP ?? "*/30 * * * * *",
		metricsInterval: process.env.III_METRICS_INTERVAL ?? "*/60 * * * * *",
		allowedImages: (process.env.III_ALLOWED_IMAGES ?? "*").split(",").map((s) => s.trim()),
		workspaceDir: process.env.III_WORKSPACE_DIR ?? "/workspace",
		maxCommandTimeout: parseInt(process.env.III_MAX_CMD_TIMEOUT ?? "300", 10)
	};
}

//#endregion
//#region src/state/kv.ts
var StateKV = class {
	sdk;
	constructor(sdk) {
		this.sdk = sdk;
	}
	async get(scope, key) {
		return this.sdk.trigger("state::get", {
			scope,
			key
		});
	}
	async set(scope, key, data) {
		return this.sdk.trigger("state::set", {
			scope,
			key,
			value: data
		});
	}
	async delete(scope, key) {
		return this.sdk.trigger("state::delete", {
			scope,
			key
		});
	}
	async list(scope) {
		return this.sdk.trigger("state::list", { scope });
	}
};

//#endregion
//#region src/state/schema.ts
const SCOPES = {
	SANDBOXES: "sandbox",
	METRICS: "metrics",
	GLOBAL: "global",
	BACKGROUND: "background"
};
function generateId(prefix = "sbx") {
	return `${prefix}_${randomBytes(12).toString("hex")}`;
}

//#endregion
//#region src/docker/client.ts
const docker = new Docker();
function getDocker() {
	return docker;
}
async function createContainer(id, config, entrypoint) {
	const containerOpts = {
		Image: config.image,
		name: `iii-sbx-${id}`,
		Hostname: id,
		WorkingDir: config.workdir ?? "/workspace",
		Env: Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`),
		Tty: false,
		OpenStdin: false,
		HostConfig: {
			Memory: (config.memory ?? 512) * 1024 * 1024,
			CpuShares: (config.cpu ?? 1) * 1024,
			PidsLimit: 256,
			SecurityOpt: ["no-new-privileges"],
			CapDrop: [
				"NET_RAW",
				"SYS_ADMIN",
				"MKNOD"
			],
			NetworkMode: config.network ? "bridge" : "none",
			ReadonlyRootfs: false
		},
		Labels: {
			"iii-sandbox": "true",
			"iii-sandbox-id": id
		}
	};
	if (entrypoint && entrypoint.length > 0) containerOpts.Entrypoint = entrypoint;
	else containerOpts.Cmd = [
		"tail",
		"-f",
		"/dev/null"
	];
	const container = await docker.createContainer(containerOpts);
	await container.start();
	return container;
}
async function execInContainer(container, command, timeoutMs) {
	const start = Date.now();
	const exec = await container.exec({
		Cmd: command,
		AttachStdout: true,
		AttachStderr: true
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(/* @__PURE__ */ new Error(`Command timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		exec.start({
			hijack: true,
			stdin: false
		}, (err, stream) => {
			if (err || !stream) {
				clearTimeout(timer);
				return reject(err ?? /* @__PURE__ */ new Error("No stream"));
			}
			let stdout = "";
			let stderr = "";
			const passStdout = new PassThrough();
			const passStderr = new PassThrough();
			docker.modem.demuxStream(stream, passStdout, passStderr);
			passStdout.on("data", (d) => {
				stdout += d.toString();
			});
			passStderr.on("data", (d) => {
				stderr += d.toString();
			});
			stream.on("end", async () => {
				clearTimeout(timer);
				resolve({
					exitCode: (await exec.inspect()).ExitCode ?? -1,
					stdout,
					stderr,
					duration: Date.now() - start
				});
			});
		});
	});
}
async function execStreamInContainer(container, command, timeoutMs, onChunk) {
	const exec = await container.exec({
		Cmd: command,
		AttachStdout: true,
		AttachStderr: true
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			onChunk({
				type: "exit",
				data: "-1",
				timestamp: Date.now()
			});
			reject(/* @__PURE__ */ new Error(`Command timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		exec.start({
			hijack: true,
			stdin: false
		}, (err, stream) => {
			if (err || !stream) {
				clearTimeout(timer);
				return reject(err ?? /* @__PURE__ */ new Error("No stream"));
			}
			const passStdout = new PassThrough();
			const passStderr = new PassThrough();
			docker.modem.demuxStream(stream, passStdout, passStderr);
			passStdout.on("data", (d) => {
				onChunk({
					type: "stdout",
					data: d.toString(),
					timestamp: Date.now()
				});
			});
			passStderr.on("data", (d) => {
				onChunk({
					type: "stderr",
					data: d.toString(),
					timestamp: Date.now()
				});
			});
			stream.on("end", async () => {
				clearTimeout(timer);
				const inspect = await exec.inspect();
				onChunk({
					type: "exit",
					data: String(inspect.ExitCode ?? -1),
					timestamp: Date.now()
				});
				resolve();
			});
		});
	});
}
async function getContainerStats(container) {
	const stats = await container.stats({ stream: false });
	const info = await container.inspect();
	const id = info.Config?.Labels?.["iii-sandbox-id"] ?? info.Id.slice(0, 12);
	const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
	const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
	const cpuCount = stats.cpu_stats.online_cpus ?? 1;
	return {
		sandboxId: id,
		cpuPercent: systemDelta > 0 ? cpuDelta / systemDelta * cpuCount * 100 : 0,
		memoryUsageMb: Math.round(stats.memory_stats.usage / 1024 / 1024),
		memoryLimitMb: Math.round(stats.memory_stats.limit / 1024 / 1024),
		networkRxBytes: stats.networks?.eth0?.rx_bytes ?? 0,
		networkTxBytes: stats.networks?.eth0?.tx_bytes ?? 0,
		pids: stats.pids_stats?.current ?? 0
	};
}
async function copyToContainer(container, path, content) {
	const { pack } = await import("tar-stream");
	const tarStream = pack();
	const name = path.split("/").pop();
	const dir = path.substring(0, path.lastIndexOf("/")) || "/";
	tarStream.entry({ name }, content);
	tarStream.finalize();
	await container.putArchive(tarStream, { path: dir });
}
async function copyFromContainer(container, path) {
	const stream = await container.getArchive({ path });
	const { extract } = await import("tar-stream");
	const ex = extract();
	return new Promise((resolve, reject) => {
		const chunks = [];
		ex.on("entry", (_header, entryStream, next) => {
			entryStream.on("data", (chunk) => chunks.push(chunk));
			entryStream.on("end", next);
		});
		ex.on("finish", () => resolve(Buffer.concat(chunks)));
		ex.on("error", reject);
		stream.pipe(ex);
	});
}
async function listContainerDir(container, path) {
	const result = await execInContainer(container, [
		"find",
		path,
		"-maxdepth",
		"1",
		"-printf",
		"%f\\t%s\\t%T@\\t%y\\n"
	], 1e4);
	if (result.exitCode !== 0) return [];
	return result.stdout.trim().split("\n").filter(Boolean).slice(1).map((line) => {
		const [name, size, mtime, type] = line.split("	");
		return {
			name,
			path: `${path}/${name}`.replace("//", "/"),
			size: parseInt(size, 10) || 0,
			isDirectory: type === "d",
			modifiedAt: Math.floor(parseFloat(mtime) * 1e3)
		};
	});
}
async function searchInContainer(container, dir, pattern) {
	const result = await execInContainer(container, [
		"find",
		dir,
		"-name",
		pattern,
		"-type",
		"f"
	], 1e4);
	if (result.exitCode !== 0) return [];
	return result.stdout.trim().split("\n").filter(Boolean);
}
async function getFileInfo(container, paths) {
	const result = await execInContainer(container, [
		"stat",
		"--format",
		"%n\\t%s\\t%A\\t%U\\t%G\\t%F\\t%Y",
		...paths
	], 1e4);
	if (result.exitCode !== 0) throw new Error(`stat failed: ${result.stderr}`);
	return result.stdout.trim().split("\\n").filter(Boolean).map((line) => {
		const [path, size, permissions, owner, group, type, mtime] = line.split("\\t");
		return {
			path,
			size: parseInt(size, 10) || 0,
			permissions,
			owner,
			group,
			isDirectory: type === "directory",
			isSymlink: type === "symbolic link",
			modifiedAt: parseInt(mtime, 10) * 1e3
		};
	});
}

//#endregion
//#region src/docker/images.ts
async function pullImage(imageName) {
	const docker = getDocker();
	await new Promise((resolve, reject) => {
		docker.pull(imageName, (err, stream) => {
			if (err) return reject(err);
			docker.modem.followProgress(stream, (err2) => {
				if (err2) return reject(err2);
				resolve();
			});
		});
	});
}
async function imageExists(imageName) {
	try {
		await getDocker().getImage(imageName).inspect();
		return true;
	} catch {
		return false;
	}
}
async function ensureImage(imageName) {
	if (!await imageExists(imageName)) await pullImage(imageName);
}

//#endregion
//#region src/security/validate.ts
function validatePath(path, workspaceDir) {
	const normalized = normalize(resolve(workspaceDir, path));
	if (!normalized.startsWith(workspaceDir)) throw new Error(`Path traversal detected: ${path}`);
	return normalized;
}
function validateSandboxConfig(input) {
	if (!input || typeof input !== "object") throw new Error("Invalid sandbox config");
	const cfg = input;
	if (!cfg.image || typeof cfg.image !== "string") throw new Error("image is required and must be a string");
	if (cfg.image.includes("..") || cfg.image.includes("$")) throw new Error("Invalid image name");
	return {
		image: cfg.image,
		name: typeof cfg.name === "string" ? cfg.name : void 0,
		timeout: typeof cfg.timeout === "number" ? Math.min(Math.max(cfg.timeout, 60), 86400) : void 0,
		memory: typeof cfg.memory === "number" ? Math.min(Math.max(cfg.memory, 64), 4096) : void 0,
		cpu: typeof cfg.cpu === "number" ? Math.min(Math.max(cfg.cpu, .5), 4) : void 0,
		network: typeof cfg.network === "boolean" ? cfg.network : void 0,
		env: cfg.env && typeof cfg.env === "object" ? cfg.env : void 0,
		workdir: typeof cfg.workdir === "string" ? cfg.workdir : void 0,
		metadata: cfg.metadata && typeof cfg.metadata === "object" ? cfg.metadata : void 0,
		entrypoint: Array.isArray(cfg.entrypoint) ? cfg.entrypoint : void 0
	};
}
function validateImageAllowed(image, allowed) {
	if (allowed.length === 1 && allowed[0] === "*") return true;
	return allowed.some((pattern) => {
		if (pattern.endsWith("*")) return image.startsWith(pattern.slice(0, -1));
		return image === pattern;
	});
}
function checkAuth(req, config) {
	if (!config.authToken) return null;
	const authHeader = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
	if (!authHeader) return {
		status_code: 401,
		body: { error: "Missing authorization header" }
	};
	if (authHeader.replace("Bearer ", "") !== config.authToken) return {
		status_code: 403,
		body: { error: "Invalid token" }
	};
	return null;
}
function validateCommand(command) {
	if (!command || typeof command !== "string") throw new Error("command is required");
	return [
		"sh",
		"-c",
		command
	];
}

//#endregion
//#region src/functions/sandbox.ts
function registerSandboxFunctions(sdk, kv, config) {
	sdk.registerFunction({
		id: "sandbox::create",
		description: "Create a new sandbox container"
	}, async (input) => {
		const ctx = getContext();
		const cfg = validateSandboxConfig(input);
		if (!validateImageAllowed(cfg.image, config.allowedImages)) throw new Error(`Image not allowed: ${cfg.image}`);
		if ((await kv.list(SCOPES.SANDBOXES)).length >= config.maxSandboxes) throw new Error(`Maximum sandbox limit reached: ${config.maxSandboxes}`);
		const id = generateId();
		const now = Date.now();
		const timeout = cfg.timeout ?? config.defaultTimeout;
		const fullConfig = {
			...cfg,
			memory: cfg.memory ?? config.defaultMemory,
			cpu: cfg.cpu ?? config.defaultCpu,
			workdir: cfg.workdir ?? config.workspaceDir
		};
		ctx.logger.info("Creating sandbox", {
			id,
			image: cfg.image
		});
		await ensureImage(cfg.image);
		await createContainer(id, fullConfig, cfg.entrypoint);
		const sandbox = {
			id,
			name: cfg.name ?? id,
			image: cfg.image,
			status: "running",
			createdAt: now,
			expiresAt: now + timeout * 1e3,
			config: fullConfig,
			metadata: cfg.metadata ?? {},
			entrypoint: cfg.entrypoint
		};
		await kv.set(SCOPES.SANDBOXES, id, sandbox);
		ctx.logger.info("Sandbox created", { id });
		return sandbox;
	});
	sdk.registerFunction({
		id: "sandbox::get",
		description: "Get sandbox by ID"
	}, async (input) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, input.id);
		if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
		return sandbox;
	});
	sdk.registerFunction({
		id: "sandbox::list",
		description: "List sandboxes with filtering"
	}, async (input) => {
		let sandboxes = await kv.list(SCOPES.SANDBOXES);
		if (input?.status) sandboxes = sandboxes.filter((s) => s.status === input.status);
		if (input?.metadata) sandboxes = sandboxes.filter((s) => Object.entries(input.metadata).every(([k, v]) => s.metadata?.[k] === v));
		const total = sandboxes.length;
		const page = input?.page ?? 1;
		const pageSize = Math.min(Math.max(input?.pageSize ?? 20, 1), 200);
		const start = (page - 1) * pageSize;
		return {
			items: sandboxes.slice(start, start + pageSize),
			total,
			page,
			pageSize
		};
	});
	sdk.registerFunction({
		id: "sandbox::renew",
		description: "Renew sandbox expiration"
	}, async (input) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, input.id);
		if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
		const minExpiry = Date.now() + 6e4;
		const maxExpiry = Date.now() + 864e5;
		sandbox.expiresAt = Math.min(Math.max(input.expiresAt, minExpiry), maxExpiry);
		await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
		return sandbox;
	});
	sdk.registerFunction({
		id: "sandbox::kill",
		description: "Kill and remove a sandbox"
	}, async (input) => {
		const ctx = getContext();
		if (!await kv.get(SCOPES.SANDBOXES, input.id)) throw new Error(`Sandbox not found: ${input.id}`);
		try {
			const container = getDocker().getContainer(`iii-sbx-${input.id}`);
			await container.stop().catch(() => {});
			await container.remove({ force: true });
		} catch {
			ctx.logger.warn("Container already removed", { id: input.id });
		}
		await kv.delete(SCOPES.SANDBOXES, input.id);
		ctx.logger.info("Sandbox killed", { id: input.id });
		return { success: true };
	});
	sdk.registerFunction({
		id: "sandbox::pause",
		description: "Pause a running sandbox"
	}, async (input) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, input.id);
		if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
		await getDocker().getContainer(`iii-sbx-${input.id}`).pause();
		sandbox.status = "paused";
		await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
		return sandbox;
	});
	sdk.registerFunction({
		id: "sandbox::resume",
		description: "Resume a paused sandbox"
	}, async (input) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, input.id);
		if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
		await getDocker().getContainer(`iii-sbx-${input.id}`).unpause();
		sandbox.status = "running";
		await kv.set(SCOPES.SANDBOXES, input.id, sandbox);
		return sandbox;
	});
}

//#endregion
//#region src/functions/command.ts
function registerCommandFunctions(sdk, kv, config) {
	const getRunningContainer = async (id) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, id);
		if (!sandbox) throw new Error(`Sandbox not found: ${id}`);
		if (sandbox.status !== "running") throw new Error(`Sandbox is not running: ${sandbox.status}`);
		return getDocker().getContainer(`iii-sbx-${id}`);
	};
	sdk.registerFunction({
		id: "cmd::run",
		description: "Execute a command in a sandbox"
	}, async (input) => {
		const ctx = getContext();
		let command = input.command;
		if (input.cwd) {
			validatePath(input.cwd, config.workspaceDir);
			command = `cd ${input.cwd} && ${command}`;
		}
		const cmd = validateCommand(command);
		const timeoutMs = Math.min((input.timeout ?? config.maxCommandTimeout) * 1e3, config.maxCommandTimeout * 1e3);
		ctx.logger.info("Executing command", {
			id: input.id,
			command: input.command
		});
		return execInContainer(await getRunningContainer(input.id), cmd, timeoutMs);
	});
	sdk.registerFunction({
		id: "cmd::run-stream",
		description: "Execute a command with streaming output"
	}, http(async (req, res) => {
		const authErr = checkAuth(req, config);
		if (authErr) {
			res.status(authErr.status_code);
			res.stream.write(JSON.stringify(authErr.body));
			res.close();
			return;
		}
		const id = req.path_params?.id;
		const body = req.body;
		const ctx = getContext();
		let cmd;
		try {
			cmd = validateCommand(body.command);
		} catch (err) {
			res.status(400);
			res.stream.write(JSON.stringify({ error: err.message }));
			res.close();
			return;
		}
		const timeoutMs = Math.min((body.timeout ?? config.maxCommandTimeout) * 1e3, config.maxCommandTimeout * 1e3);
		let container;
		try {
			container = await getRunningContainer(id);
		} catch (err) {
			const msg = err.message ?? "Internal error";
			const code = msg.includes("not found") ? 404 : 400;
			res.status(code);
			res.stream.write(JSON.stringify({ error: msg }));
			res.close();
			return;
		}
		ctx.logger.info("Streaming command", {
			id,
			command: body.command
		});
		res.status(200);
		res.headers({
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive"
		});
		try {
			await execStreamInContainer(container, cmd, timeoutMs, (chunk) => {
				res.stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
			});
		} catch {}
		res.close();
	}));
}

//#endregion
//#region src/functions/filesystem.ts
function registerFilesystemFunctions(sdk, kv, config) {
	const getContainer = async (id) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, id);
		if (!sandbox) throw new Error(`Sandbox not found: ${id}`);
		if (sandbox.status !== "running") throw new Error(`Sandbox not running: ${sandbox.status}`);
		return getDocker().getContainer(`iii-sbx-${id}`);
	};
	sdk.registerFunction({
		id: "fs::read",
		description: "Read a file from sandbox"
	}, async (input) => {
		validatePath(input.path, config.workspaceDir);
		const result = await execInContainer(await getContainer(input.id), ["cat", input.path], 1e4);
		if (result.exitCode !== 0) throw new Error(`Failed to read: ${result.stderr}`);
		return result.stdout;
	});
	sdk.registerFunction({
		id: "fs::write",
		description: "Write a file to sandbox"
	}, async (input) => {
		validatePath(input.path, config.workspaceDir);
		await copyToContainer(await getContainer(input.id), input.path, Buffer.from(input.content, "utf-8"));
		return { success: true };
	});
	sdk.registerFunction({
		id: "fs::delete",
		description: "Delete a file from sandbox"
	}, async (input) => {
		validatePath(input.path, config.workspaceDir);
		const result = await execInContainer(await getContainer(input.id), [
			"rm",
			"-f",
			input.path
		], 1e4);
		if (result.exitCode !== 0) throw new Error(`Failed to delete: ${result.stderr}`);
		return { success: true };
	});
	sdk.registerFunction({
		id: "fs::list",
		description: "List directory contents"
	}, async (input) => {
		const dir = input.path ?? config.workspaceDir;
		validatePath(dir, config.workspaceDir);
		return listContainerDir(await getContainer(input.id), dir);
	});
	sdk.registerFunction({
		id: "fs::search",
		description: "Search files by pattern"
	}, async (input) => {
		const dir = input.dir ?? config.workspaceDir;
		validatePath(dir, config.workspaceDir);
		return searchInContainer(await getContainer(input.id), dir, input.pattern);
	});
	sdk.registerFunction({
		id: "fs::upload",
		description: "Upload file (base64)"
	}, async (input) => {
		validatePath(input.path, config.workspaceDir);
		await copyToContainer(await getContainer(input.id), input.path, Buffer.from(input.content, "base64"));
		return { success: true };
	});
	sdk.registerFunction({
		id: "fs::download",
		description: "Download file (base64)"
	}, async (input) => {
		validatePath(input.path, config.workspaceDir);
		return (await copyFromContainer(await getContainer(input.id), input.path)).toString("base64");
	});
	sdk.registerFunction({
		id: "fs::info",
		description: "Get file metadata"
	}, async (input) => {
		for (const p of input.paths) validatePath(p, config.workspaceDir);
		return getFileInfo(await getContainer(input.id), input.paths);
	});
	sdk.registerFunction({
		id: "fs::move",
		description: "Move/rename files"
	}, async (input) => {
		const container = await getContainer(input.id);
		for (const { from, to } of input.moves) {
			validatePath(from, config.workspaceDir);
			validatePath(to, config.workspaceDir);
			const result = await execInContainer(container, [
				"mv",
				from,
				to
			], 1e4);
			if (result.exitCode !== 0) throw new Error(`Move failed: ${result.stderr}`);
		}
		return { success: true };
	});
	sdk.registerFunction({
		id: "fs::mkdir",
		description: "Create directories"
	}, async (input) => {
		const container = await getContainer(input.id);
		for (const p of input.paths) {
			validatePath(p, config.workspaceDir);
			const result = await execInContainer(container, [
				"mkdir",
				"-p",
				p
			], 1e4);
			if (result.exitCode !== 0) throw new Error(`Mkdir failed: ${result.stderr}`);
		}
		return { success: true };
	});
	sdk.registerFunction({
		id: "fs::rmdir",
		description: "Remove directories"
	}, async (input) => {
		const container = await getContainer(input.id);
		for (const p of input.paths) {
			validatePath(p, config.workspaceDir);
			const result = await execInContainer(container, [
				"rm",
				"-rf",
				p
			], 1e4);
			if (result.exitCode !== 0) throw new Error(`Rmdir failed: ${result.stderr}`);
		}
		return { success: true };
	});
	sdk.registerFunction({
		id: "fs::chmod",
		description: "Change file permissions"
	}, async (input) => {
		validatePath(input.path, config.workspaceDir);
		const result = await execInContainer(await getContainer(input.id), [
			"chmod",
			input.mode,
			input.path
		], 1e4);
		if (result.exitCode !== 0) throw new Error(`Chmod failed: ${result.stderr}`);
		return { success: true };
	});
}

//#endregion
//#region src/interpreter/languages.ts
const LANGUAGES = {
	python: {
		kernelName: "python3",
		fileExtension: ".py",
		installCommand: (pkgs) => [
			"pip",
			"install",
			...pkgs
		]
	},
	javascript: {
		kernelName: "javascript",
		fileExtension: ".js",
		installCommand: (pkgs) => [
			"npm",
			"install",
			"-g",
			...pkgs
		]
	},
	typescript: {
		kernelName: "typescript",
		fileExtension: ".ts",
		installCommand: (pkgs) => [
			"npm",
			"install",
			"-g",
			...pkgs
		]
	},
	go: {
		kernelName: "go",
		fileExtension: ".go",
		installCommand: (pkgs) => [
			"go",
			"install",
			...pkgs
		]
	},
	bash: {
		kernelName: "bash",
		fileExtension: ".sh",
		installCommand: (pkgs) => [
			"apt-get",
			"install",
			"-y",
			...pkgs
		]
	}
};
function getLanguageConfig(language) {
	const config = LANGUAGES[language.toLowerCase()];
	if (!config) throw new Error(`Unsupported language: ${language}`);
	return config;
}

//#endregion
//#region src/functions/interpreter.ts
function registerInterpreterFunctions(sdk, kv, config) {
	sdk.registerFunction({
		id: "interp::execute",
		description: "Run code in a sandbox"
	}, async (input) => {
		const ctx = getContext();
		if (!await kv.get(SCOPES.SANDBOXES, input.id)) throw new Error(`Sandbox not found: ${input.id}`);
		const lang = getLanguageConfig(input.language ?? "python");
		const container = getDocker().getContainer(`iii-sbx-${input.id}`);
		const filename = `/tmp/code${lang.fileExtension}`;
		const writeResult = await execInContainer(container, [
			"sh",
			"-c",
			`cat > ${filename} << 'CODEEOF'\n${input.code}\nCODEEOF`
		], 1e4);
		if (writeResult.exitCode !== 0) return {
			output: "",
			error: writeResult.stderr,
			executionTime: 0
		};
		const execCmd = getExecCommand(input.language ?? "python", filename);
		const start = Date.now();
		const result = await execInContainer(container, execCmd, config.maxCommandTimeout * 1e3);
		ctx.logger.info("Code executed", {
			id: input.id,
			language: input.language
		});
		return {
			output: result.stdout,
			error: result.exitCode !== 0 ? result.stderr : void 0,
			executionTime: Date.now() - start
		};
	});
	sdk.registerFunction({
		id: "interp::install",
		description: "Install packages in sandbox"
	}, async (input) => {
		if (!await kv.get(SCOPES.SANDBOXES, input.id)) throw new Error(`Sandbox not found: ${input.id}`);
		const lang = getLanguageConfig(input.manager ?? "python");
		const result = await execInContainer(getDocker().getContainer(`iii-sbx-${input.id}`), lang.installCommand(input.packages), 12e4);
		if (result.exitCode !== 0) throw new Error(`Install failed: ${result.stderr}`);
		return { output: result.stdout };
	});
	sdk.registerFunction({
		id: "interp::kernels",
		description: "List available languages/kernels"
	}, async () => {
		return [
			{
				name: "python3",
				language: "python",
				displayName: "Python 3"
			},
			{
				name: "node",
				language: "javascript",
				displayName: "Node.js"
			},
			{
				name: "bash",
				language: "bash",
				displayName: "Bash"
			},
			{
				name: "go",
				language: "go",
				displayName: "Go"
			}
		];
	});
}
function getExecCommand(language, filename) {
	switch (language.toLowerCase()) {
		case "python": return ["python3", filename];
		case "javascript": return ["node", filename];
		case "typescript": return [
			"npx",
			"tsx",
			filename
		];
		case "go": return [
			"go",
			"run",
			filename
		];
		case "bash": return ["bash", filename];
		default: return ["python3", filename];
	}
}

//#endregion
//#region src/functions/background.ts
const BG_SCOPE = "background";
function registerBackgroundFunctions(sdk, kv, config) {
	sdk.registerFunction({
		id: "cmd::background",
		description: "Run command in background"
	}, async (input) => {
		const sandbox = await kv.get(SCOPES.SANDBOXES, input.id);
		if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
		if (sandbox.status !== "running") throw new Error(`Sandbox not running: ${sandbox.status}`);
		const execId = generateId("bg");
		const cmd = validateCommand(input.command);
		await (await getDocker().getContainer(`iii-sbx-${input.id}`).exec({
			Cmd: [
				...cmd,
				">",
				`/tmp/${execId}.log`,
				"2>&1",
				"&"
			],
			AttachStdout: false,
			AttachStderr: false,
			Detach: true
		})).start({ Detach: true });
		const bg = {
			id: execId,
			sandboxId: input.id,
			command: input.command,
			running: true,
			startedAt: Date.now()
		};
		await kv.set(BG_SCOPE, execId, bg);
		return bg;
	});
	sdk.registerFunction({
		id: "cmd::background-status",
		description: "Get background command status"
	}, async (input) => {
		const bg = await kv.get(BG_SCOPE, input.id);
		if (!bg) throw new Error(`Background exec not found: ${input.id}`);
		return bg;
	});
	sdk.registerFunction({
		id: "cmd::background-logs",
		description: "Get background command logs"
	}, async (input) => {
		const bg = await kv.get(BG_SCOPE, input.id);
		if (!bg) throw new Error(`Background exec not found: ${input.id}`);
		const container = getDocker().getContainer(`iii-sbx-${bg.sandboxId}`);
		const logFile = `/tmp/${input.id}.log`;
		const skip = input.cursor ?? 0;
		const result = await execInContainer(container, [
			"sh",
			"-c",
			`tail -c +${skip + 1} ${logFile} 2>/dev/null || echo ""`
		], 1e4);
		return {
			output: result.stdout,
			cursor: skip + Buffer.byteLength(result.stdout)
		};
	});
	sdk.registerFunction({
		id: "cmd::interrupt",
		description: "Interrupt a running command"
	}, async (input) => {
		if (!await kv.get(SCOPES.SANDBOXES, input.id)) throw new Error(`Sandbox not found: ${input.id}`);
		const container = getDocker().getContainer(`iii-sbx-${input.id}`);
		if (input.pid) await execInContainer(container, [
			"kill",
			"-SIGINT",
			String(input.pid)
		], 5e3);
		else await execInContainer(container, [
			"pkill",
			"-SIGINT",
			"-f",
			"sh -c"
		], 5e3);
		return { success: true };
	});
}

//#endregion
//#region src/functions/metrics.ts
const startTime = Date.now();
let totalCreated = 0;
let totalKilled = 0;
let totalExpired = 0;
function incrementExpired() {
	totalExpired++;
}
function registerMetricsFunctions(sdk, kv) {
	sdk.registerFunction({
		id: "metrics::sandbox",
		description: "Get metrics for a sandbox"
	}, async (input) => {
		if (!await kv.get(SCOPES.SANDBOXES, input.id)) throw new Error(`Sandbox not found: ${input.id}`);
		return getContainerStats(getDocker().getContainer(`iii-sbx-${input.id}`));
	});
	sdk.registerFunction({
		id: "metrics::global",
		description: "Get global metrics"
	}, async () => {
		return {
			activeSandboxes: (await kv.list(SCOPES.SANDBOXES)).length,
			totalCreated,
			totalKilled,
			totalExpired,
			uptimeSeconds: Math.floor((Date.now() - startTime) / 1e3)
		};
	});
}

//#endregion
//#region src/lifecycle/ttl.ts
function registerTtlSweep(sdk, kv) {
	sdk.registerFunction({
		id: "lifecycle::ttl-sweep",
		description: "Kill expired sandboxes"
	}, async () => {
		const ctx = getContext();
		const sandboxes = await kv.list(SCOPES.SANDBOXES);
		const now = Date.now();
		let swept = 0;
		for (const sandbox of sandboxes) if (sandbox.expiresAt <= now) {
			ctx.logger.info("Expiring sandbox", { id: sandbox.id });
			try {
				const container = getDocker().getContainer(`iii-sbx-${sandbox.id}`);
				await container.stop().catch(() => {});
				await container.remove({ force: true });
			} catch {}
			await kv.delete(SCOPES.SANDBOXES, sandbox.id);
			incrementExpired();
			swept++;
		}
		if (swept > 0) ctx.logger.info("TTL sweep complete", { swept });
		return { swept };
	});
	sdk.registerFunction({
		id: "lifecycle::health",
		description: "Health check"
	}, async () => {
		return {
			status: "healthy",
			uptime: Math.floor(process.uptime())
		};
	});
}

//#endregion
//#region src/triggers/api.ts
function registerApiTriggers(sdk, config) {
	const p = config.apiPrefix;
	const wrap = (fnId, method, path, requireAuth = true) => {
		const wrappedId = `api::${fnId}`;
		sdk.registerFunction({ id: wrappedId }, async (req) => {
			if (requireAuth) {
				const authErr = checkAuth(req, config);
				if (authErr) return authErr;
			}
			try {
				return {
					status_code: 200,
					body: await sdk.trigger(fnId, {
						...req.body,
						...req.path_params,
						...req.query_params
					})
				};
			} catch (err) {
				const msg = err?.message ?? "Internal error";
				let code = 500;
				if (msg.includes("not found")) code = 404;
				else if (msg.includes("not allowed")) code = 403;
				return {
					status_code: code,
					body: { error: msg }
				};
			}
		});
		sdk.registerTrigger({
			type: "http",
			function_id: wrappedId,
			config: {
				api_path: `${p}${path}`,
				http_method: method
			}
		});
	};
	wrap("sandbox::create", "POST", "/sandboxes");
	wrap("sandbox::list", "GET", "/sandboxes");
	wrap("sandbox::get", "GET", "/sandboxes/:id");
	wrap("sandbox::kill", "DELETE", "/sandboxes/:id");
	wrap("sandbox::pause", "POST", "/sandboxes/:id/pause");
	wrap("sandbox::resume", "POST", "/sandboxes/:id/resume");
	wrap("sandbox::renew", "POST", "/sandboxes/:id/renew");
	wrap("cmd::run", "POST", "/sandboxes/:id/exec");
	wrap("cmd::background", "POST", "/sandboxes/:id/exec/background");
	sdk.registerTrigger({
		type: "http",
		function_id: "cmd::run-stream",
		config: {
			api_path: `${p}/sandboxes/:id/exec/stream`,
			http_method: "POST"
		}
	});
	wrap("cmd::background-status", "GET", "/exec/background/:id/status");
	wrap("cmd::background-logs", "GET", "/exec/background/:id/logs");
	wrap("cmd::interrupt", "POST", "/sandboxes/:id/exec/interrupt");
	wrap("fs::read", "POST", "/sandboxes/:id/files/read");
	wrap("fs::write", "POST", "/sandboxes/:id/files/write");
	wrap("fs::delete", "POST", "/sandboxes/:id/files/delete");
	wrap("fs::list", "POST", "/sandboxes/:id/files/list");
	wrap("fs::search", "POST", "/sandboxes/:id/files/search");
	wrap("fs::upload", "POST", "/sandboxes/:id/files/upload");
	wrap("fs::download", "POST", "/sandboxes/:id/files/download");
	wrap("fs::info", "POST", "/sandboxes/:id/files/info");
	wrap("fs::move", "POST", "/sandboxes/:id/files/move");
	wrap("fs::mkdir", "POST", "/sandboxes/:id/files/mkdir");
	wrap("fs::rmdir", "POST", "/sandboxes/:id/files/rmdir");
	wrap("fs::chmod", "POST", "/sandboxes/:id/files/chmod");
	wrap("interp::execute", "POST", "/sandboxes/:id/interpret/execute");
	wrap("interp::install", "POST", "/sandboxes/:id/interpret/install");
	wrap("interp::kernels", "GET", "/sandboxes/:id/interpret/kernels");
	wrap("metrics::sandbox", "GET", "/sandboxes/:id/metrics");
	wrap("metrics::global", "GET", "/metrics");
	wrap("lifecycle::health", "GET", "/health", false);
	wrap("lifecycle::ttl-sweep", "POST", "/admin/sweep");
}

//#endregion
//#region src/triggers/cron.ts
function registerCronTriggers(sdk, config) {
	sdk.registerTrigger({
		type: "cron",
		function_id: "lifecycle::ttl-sweep",
		config: { expression: config.ttlSweepInterval }
	});
}

//#endregion
//#region src/triggers/events.ts
function registerEventTriggers(sdk) {
	for (const { id, topic } of [
		{
			id: "event::sandbox-created",
			topic: "sandbox.created"
		},
		{
			id: "event::sandbox-killed",
			topic: "sandbox.killed"
		},
		{
			id: "event::sandbox-expired",
			topic: "sandbox.expired"
		}
	]) {
		sdk.registerFunction({ id }, async (data) => {
			getContext().logger.info(`${topic} event`, data);
		});
		sdk.registerTrigger({
			type: "queue",
			function_id: id,
			config: { topic }
		});
	}
}

//#endregion
//#region src/lifecycle/cleanup.ts
async function cleanupAll(kv) {
	const sandboxes = await kv.list(SCOPES.SANDBOXES);
	const docker = getDocker();
	for (const sandbox of sandboxes) {
		try {
			const container = docker.getContainer(`iii-sbx-${sandbox.id}`);
			await container.stop().catch(() => {});
			await container.remove({ force: true });
		} catch {}
		await kv.delete(SCOPES.SANDBOXES, sandbox.id);
	}
}

//#endregion
//#region src/index.ts
async function main() {
	const config = loadConfig();
	console.log(`[iii-sandbox] Starting worker: ${config.workerName}`);
	console.log(`[iii-sandbox] Engine: ${config.engineUrl}`);
	console.log(`[iii-sandbox] API prefix: ${config.apiPrefix}`);
	const sdk = init(config.engineUrl, { workerName: config.workerName });
	const kv = new StateKV(sdk);
	registerSandboxFunctions(sdk, kv, config);
	registerCommandFunctions(sdk, kv, config);
	registerFilesystemFunctions(sdk, kv, config);
	registerInterpreterFunctions(sdk, kv, config);
	registerBackgroundFunctions(sdk, kv, config);
	registerMetricsFunctions(sdk, kv);
	registerTtlSweep(sdk, kv);
	registerApiTriggers(sdk, config);
	registerCronTriggers(sdk, config);
	registerEventTriggers(sdk);
	console.log("[iii-sandbox] All functions and triggers registered");
	console.log(`[iii-sandbox] REST API at http://localhost:${config.restPort}${config.apiPrefix}`);
	const shutdown = async () => {
		console.log("[iii-sandbox] Shutting down...");
		await cleanupAll(kv);
		await sdk.shutdown();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
main().catch((err) => {
	console.error("[iii-sandbox] Fatal error:", err);
	process.exit(1);
});

//#endregion
export {  };
//# sourceMappingURL=index.js.map