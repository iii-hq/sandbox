import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSandbox, getSandbox, listSandboxes } from "@iii-sandbox/sdk";
import { z } from "zod";

//#region src/tools.ts
const tools = [
	{
		name: "sandbox_create",
		description: "Create a new Docker sandbox for code execution",
		inputSchema: z.object({
			image: z.string().default("python:3.12-slim").describe("Docker image to use"),
			name: z.string().optional().describe("Optional sandbox name"),
			timeout: z.number().optional().describe("TTL in seconds (default 3600)"),
			memory: z.number().optional().describe("Memory limit in MB (default 512)"),
			network: z.boolean().optional().describe("Enable networking (default false)")
		})
	},
	{
		name: "sandbox_exec",
		description: "Run a shell command in a sandbox",
		inputSchema: z.object({
			sandboxId: z.string().describe("Sandbox ID"),
			command: z.string().describe("Shell command to execute"),
			timeout: z.number().optional().describe("Timeout in seconds")
		})
	},
	{
		name: "sandbox_run_code",
		description: "Execute code in a sandbox (Python, JavaScript, Go, Bash)",
		inputSchema: z.object({
			sandboxId: z.string().describe("Sandbox ID"),
			code: z.string().describe("Code to execute"),
			language: z.enum([
				"python",
				"javascript",
				"typescript",
				"go",
				"bash"
			]).default("python")
		})
	},
	{
		name: "sandbox_read_file",
		description: "Read file contents from a sandbox",
		inputSchema: z.object({
			sandboxId: z.string().describe("Sandbox ID"),
			path: z.string().describe("File path inside the sandbox")
		})
	},
	{
		name: "sandbox_write_file",
		description: "Write content to a file in a sandbox",
		inputSchema: z.object({
			sandboxId: z.string().describe("Sandbox ID"),
			path: z.string().describe("File path inside the sandbox"),
			content: z.string().describe("File content")
		})
	},
	{
		name: "sandbox_list_files",
		description: "List files in a sandbox directory",
		inputSchema: z.object({
			sandboxId: z.string().describe("Sandbox ID"),
			path: z.string().default("/workspace").describe("Directory path")
		})
	},
	{
		name: "sandbox_install_package",
		description: "Install a package in a sandbox (pip, npm, or go)",
		inputSchema: z.object({
			sandboxId: z.string().describe("Sandbox ID"),
			packages: z.array(z.string()).describe("Package names to install"),
			manager: z.enum([
				"pip",
				"npm",
				"go"
			]).default("pip")
		})
	},
	{
		name: "sandbox_list",
		description: "List all active sandboxes",
		inputSchema: z.object({})
	},
	{
		name: "sandbox_kill",
		description: "Kill and remove a sandbox",
		inputSchema: z.object({ sandboxId: z.string().describe("Sandbox ID") })
	},
	{
		name: "sandbox_metrics",
		description: "Get resource usage metrics for a sandbox",
		inputSchema: z.object({ sandboxId: z.string().describe("Sandbox ID") })
	}
];

//#endregion
//#region src/server.ts
function createMcpServer(config) {
	const server = new McpServer({
		name: "iii-sandbox",
		version: "0.1.0"
	});
	const cfg = {
		baseUrl: config?.baseUrl ?? process.env.III_SANDBOX_URL ?? "http://localhost:3111",
		token: config?.token ?? process.env.III_SANDBOX_TOKEN
	};
	server.tool(tools[0].name, tools[0].description, tools[0].inputSchema.shape, async (args) => {
		const sbx = await createSandbox({
			...args,
			baseUrl: cfg.baseUrl,
			token: cfg.token
		});
		return { content: [{
			type: "text",
			text: JSON.stringify(sbx.info, null, 2)
		}] };
	});
	server.tool(tools[1].name, tools[1].description, tools[1].inputSchema.shape, async (args) => {
		const result = await (await getSandbox(args.sandboxId, cfg)).exec(args.command, args.timeout);
		return {
			content: [{
				type: "text",
				text: result.stderr ? `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}` : result.stdout
			}],
			isError: result.exitCode !== 0
		};
	});
	server.tool(tools[2].name, tools[2].description, tools[2].inputSchema.shape, async (args) => {
		const result = await (await getSandbox(args.sandboxId, cfg)).interpreter.run(args.code, args.language);
		return {
			content: [{
				type: "text",
				text: result.error ? `ERROR:\n${result.error}\n\nOUTPUT:\n${result.output}` : result.output
			}],
			isError: !!result.error
		};
	});
	server.tool(tools[3].name, tools[3].description, tools[3].inputSchema.shape, async (args) => {
		return { content: [{
			type: "text",
			text: await (await getSandbox(args.sandboxId, cfg)).filesystem.read(args.path)
		}] };
	});
	server.tool(tools[4].name, tools[4].description, tools[4].inputSchema.shape, async (args) => {
		await (await getSandbox(args.sandboxId, cfg)).filesystem.write(args.path, args.content);
		return { content: [{
			type: "text",
			text: `Written to ${args.path}`
		}] };
	});
	server.tool(tools[5].name, tools[5].description, tools[5].inputSchema.shape, async (args) => {
		const files = await (await getSandbox(args.sandboxId, cfg)).filesystem.list(args.path);
		return { content: [{
			type: "text",
			text: JSON.stringify(files, null, 2)
		}] };
	});
	server.tool(tools[6].name, tools[6].description, tools[6].inputSchema.shape, async (args) => {
		return { content: [{
			type: "text",
			text: await (await getSandbox(args.sandboxId, cfg)).interpreter.install(args.packages, args.manager)
		}] };
	});
	server.tool(tools[7].name, tools[7].description, tools[7].inputSchema.shape, async () => {
		const sandboxes = await listSandboxes(cfg);
		return { content: [{
			type: "text",
			text: JSON.stringify(sandboxes, null, 2)
		}] };
	});
	server.tool(tools[8].name, tools[8].description, tools[8].inputSchema.shape, async (args) => {
		await (await getSandbox(args.sandboxId, cfg)).kill();
		return { content: [{
			type: "text",
			text: `Sandbox ${args.sandboxId} killed`
		}] };
	});
	server.tool(tools[9].name, tools[9].description, tools[9].inputSchema.shape, async (args) => {
		const metrics = await (await getSandbox(args.sandboxId, cfg)).metrics();
		return { content: [{
			type: "text",
			text: JSON.stringify(metrics, null, 2)
		}] };
	});
	return server;
}

//#endregion
//#region src/index.ts
async function main() {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
main().catch((err) => {
	console.error("MCP server error:", err);
	process.exit(1);
});

//#endregion
export {  };
//# sourceMappingURL=index.js.map