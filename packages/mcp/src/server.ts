import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createSandbox, getSandbox, listSandboxes } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"
import { tools } from "./tools.js"

export function createMcpServer(config?: ClientConfig): McpServer {
  const server = new McpServer({
    name: "iii-sandbox",
    version: "0.1.0",
  })

  const cfg = {
    baseUrl: config?.baseUrl ?? process.env.III_SANDBOX_URL ?? "http://localhost:3111",
    token: config?.token ?? process.env.III_SANDBOX_TOKEN,
  }

  server.tool(
    tools[0].name,
    tools[0].description,
    tools[0].inputSchema.shape,
    async (args) => {
      const sbx = await createSandbox({ ...args, baseUrl: cfg.baseUrl, token: cfg.token })
      return { content: [{ type: "text", text: JSON.stringify(sbx.info, null, 2) }] }
    },
  )

  server.tool(
    tools[1].name,
    tools[1].description,
    tools[1].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      const result = await sbx.exec(args.command, args.timeout)
      const output = result.stderr ? `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}` : result.stdout
      return {
        content: [{ type: "text", text: output }],
        isError: result.exitCode !== 0,
      }
    },
  )

  server.tool(
    tools[2].name,
    tools[2].description,
    tools[2].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      const result = await sbx.interpreter.run(args.code, args.language)
      return {
        content: [{ type: "text", text: result.error ? `ERROR:\n${result.error}\n\nOUTPUT:\n${result.output}` : result.output }],
        isError: !!result.error,
      }
    },
  )

  server.tool(
    tools[3].name,
    tools[3].description,
    tools[3].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      const content = await sbx.filesystem.read(args.path)
      return { content: [{ type: "text", text: content }] }
    },
  )

  server.tool(
    tools[4].name,
    tools[4].description,
    tools[4].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      await sbx.filesystem.write(args.path, args.content)
      return { content: [{ type: "text", text: `Written to ${args.path}` }] }
    },
  )

  server.tool(
    tools[5].name,
    tools[5].description,
    tools[5].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      const files = await sbx.filesystem.list(args.path)
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] }
    },
  )

  server.tool(
    tools[6].name,
    tools[6].description,
    tools[6].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      const output = await sbx.interpreter.install(args.packages, args.manager as "pip" | "npm" | "go")
      return { content: [{ type: "text", text: output }] }
    },
  )

  server.tool(
    tools[7].name,
    tools[7].description,
    tools[7].inputSchema.shape,
    async () => {
      const sandboxes = await listSandboxes(cfg)
      return { content: [{ type: "text", text: JSON.stringify(sandboxes, null, 2) }] }
    },
  )

  server.tool(
    tools[8].name,
    tools[8].description,
    tools[8].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      await sbx.kill()
      return { content: [{ type: "text", text: `Sandbox ${args.sandboxId} killed` }] }
    },
  )

  server.tool(
    tools[9].name,
    tools[9].description,
    tools[9].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg)
      const metrics = await sbx.metrics()
      return { content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }] }
    },
  )

  return server
}
