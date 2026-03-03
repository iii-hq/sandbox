//#region src/client.ts
var HttpClient = class {
	baseUrl;
	token;
	constructor(config) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.token = config.token;
	}
	headers() {
		const h = { "Content-Type": "application/json" };
		if (this.token) h["Authorization"] = `Bearer ${this.token}`;
		return h;
	}
	async get(path) {
		const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
		if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
		return res.json();
	}
	async post(path, body) {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: "POST",
			headers: this.headers(),
			body: body ? JSON.stringify(body) : void 0
		});
		if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
		return res.json();
	}
	async del(path) {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: "DELETE",
			headers: this.headers()
		});
		if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
		return res.json();
	}
	async stream(path, body) {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: "POST",
			headers: {
				...this.headers(),
				"Accept": "text/event-stream"
			},
			body: body ? JSON.stringify(body) : void 0
		});
		if (!res.ok) throw new Error(`STREAM ${path} failed: ${res.status}`);
		return this.readSSE(res);
	}
	async *readSSE(res) {
		const reader = res.body?.getReader();
		if (!reader) return;
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) if (line.startsWith("data: ")) yield line.slice(6);
		}
	}
};

//#endregion
//#region src/filesystem.ts
var FileSystem = class {
	constructor(client, sandboxId) {
		this.client = client;
		this.sandboxId = sandboxId;
	}
	async read(path) {
		return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/read`, { path });
	}
	async write(path, content) {
		await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/write`, {
			path,
			content
		});
	}
	async delete(path) {
		await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/delete`, { path });
	}
	async list(path = "/workspace") {
		return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/list`, { path });
	}
	async search(pattern, dir = "/workspace") {
		return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/search`, {
			pattern,
			dir
		});
	}
	async upload(path, content) {
		await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/upload`, {
			path,
			content
		});
	}
	async download(path) {
		return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/download`, { path });
	}
};

//#endregion
//#region src/interpreter.ts
var CodeInterpreter = class {
	constructor(client, sandboxId) {
		this.client = client;
		this.sandboxId = sandboxId;
	}
	async run(code, language = "python") {
		return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/interpret/execute`, {
			code,
			language
		});
	}
	async install(packages, manager = "pip") {
		return (await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/interpret/install`, {
			packages,
			manager
		})).output;
	}
	async kernels() {
		return this.client.get(`/sandbox/sandboxes/${this.sandboxId}/interpret/kernels`);
	}
};

//#endregion
//#region src/stream.ts
async function* parseExecStream(lines) {
	for await (const line of lines) try {
		const chunk = JSON.parse(line);
		yield chunk;
		if (chunk.type === "exit") return;
	} catch {
		yield {
			type: "stdout",
			data: line,
			timestamp: Date.now()
		};
	}
}

//#endregion
//#region src/sandbox.ts
var Sandbox = class {
	filesystem;
	interpreter;
	constructor(client, info) {
		this.client = client;
		this.info = info;
		this.filesystem = new FileSystem(client, info.id);
		this.interpreter = new CodeInterpreter(client, info.id);
	}
	get id() {
		return this.info.id;
	}
	get status() {
		return this.info.status;
	}
	async exec(command, timeout) {
		return this.client.post(`/sandbox/sandboxes/${this.info.id}/exec`, {
			command,
			timeout
		});
	}
	async execStream(command) {
		return parseExecStream(await this.client.stream(`/sandbox/sandboxes/${this.info.id}/exec/stream`, { command }));
	}
	async pause() {
		await this.client.post(`/sandbox/sandboxes/${this.info.id}/pause`);
	}
	async resume() {
		await this.client.post(`/sandbox/sandboxes/${this.info.id}/resume`);
	}
	async kill() {
		await this.client.del(`/sandbox/sandboxes/${this.info.id}`);
	}
	async metrics() {
		return this.client.get(`/sandbox/sandboxes/${this.info.id}/metrics`);
	}
	async refresh() {
		const updated = await this.client.get(`/sandbox/sandboxes/${this.info.id}`);
		Object.assign(this.info, updated);
		return updated;
	}
};

//#endregion
//#region src/index.ts
const DEFAULT_BASE_URL = "http://localhost:3111";
async function createSandbox(options = {}) {
	const { baseUrl, token, ...config } = options;
	const client = new HttpClient({
		baseUrl: baseUrl ?? DEFAULT_BASE_URL,
		token
	});
	return new Sandbox(client, await client.post("/sandbox/sandboxes", {
		image: config.image ?? "python:3.12-slim",
		...config
	}));
}
async function listSandboxes(config) {
	return new HttpClient({
		baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
		token: config?.token
	}).get("/sandbox/sandboxes");
}
async function getSandbox(id, config) {
	const client = new HttpClient({
		baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
		token: config?.token
	});
	return new Sandbox(client, await client.get(`/sandbox/sandboxes/${id}`));
}

//#endregion
export { CodeInterpreter, FileSystem, Sandbox, createSandbox, getSandbox, listSandboxes };
//# sourceMappingURL=index.js.map