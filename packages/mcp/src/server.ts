import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  listTemplates,
  HttpClient,
  EventManager,
  NetworkManager,
  ObservabilityClient,
  VolumeManager,
} from "@iii-sandbox/sdk";
import type { ClientConfig } from "@iii-sandbox/sdk";
import { tools } from "./tools.js";

export function createMcpServer(config?: ClientConfig): McpServer {
  const server = new McpServer({
    name: "iii-sandbox",
    version: "0.1.0",
  });

  const cfg = {
    baseUrl:
      config?.baseUrl ?? process.env.III_SANDBOX_URL ?? "http://localhost:3111",
    token: config?.token ?? process.env.III_SANDBOX_TOKEN,
  };

  server.tool(
    tools[0].name,
    tools[0].description,
    tools[0].inputSchema.shape,
    async (args) => {
      const sbx = await createSandbox({
        ...args,
        baseUrl: cfg.baseUrl,
        token: cfg.token,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(sbx.info, null, 2) }],
      };
    },
  );

  server.tool(
    tools[1].name,
    tools[1].description,
    tools[1].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.exec(args.command, args.timeout);
      const output = result.stderr
        ? `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
        : result.stdout;
      return {
        content: [{ type: "text", text: output }],
        isError: result.exitCode !== 0,
      };
    },
  );

  server.tool(
    tools[2].name,
    tools[2].description,
    tools[2].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.interpreter.run(args.code, args.language);
      return {
        content: [
          {
            type: "text",
            text: result.error
              ? `ERROR:\n${result.error}\n\nOUTPUT:\n${result.output}`
              : result.output,
          },
        ],
        isError: !!result.error,
      };
    },
  );

  server.tool(
    tools[3].name,
    tools[3].description,
    tools[3].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const content = await sbx.filesystem.read(args.path);
      return { content: [{ type: "text", text: content }] };
    },
  );

  server.tool(
    tools[4].name,
    tools[4].description,
    tools[4].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      await sbx.filesystem.write(args.path, args.content);
      return { content: [{ type: "text", text: `Written to ${args.path}` }] };
    },
  );

  server.tool(
    tools[5].name,
    tools[5].description,
    tools[5].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const files = await sbx.filesystem.list(args.path);
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
      };
    },
  );

  server.tool(
    tools[6].name,
    tools[6].description,
    tools[6].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const output = await sbx.interpreter.install(
        args.packages,
        args.manager as "pip" | "npm" | "go",
      );
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.tool(
    tools[7].name,
    tools[7].description,
    tools[7].inputSchema.shape,
    async () => {
      const sandboxes = await listSandboxes(cfg);
      return {
        content: [{ type: "text", text: JSON.stringify(sandboxes, null, 2) }],
      };
    },
  );

  server.tool(
    tools[8].name,
    tools[8].description,
    tools[8].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      await sbx.kill();
      return {
        content: [{ type: "text", text: `Sandbox ${args.sandboxId} killed` }],
      };
    },
  );

  server.tool(
    tools[9].name,
    tools[9].description,
    tools[9].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const metrics = await sbx.metrics();
      return {
        content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }],
      };
    },
  );

  server.tool(
    tools[10].name,
    tools[10].description,
    tools[10].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.env.get(args.key);
      if (!result.exists)
        return { content: [{ type: "text", text: `${args.key} is not set` }] };
      return {
        content: [{ type: "text", text: `${result.key}=${result.value}` }],
      };
    },
  );

  server.tool(
    tools[11].name,
    tools[11].description,
    tools[11].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.env.set(args.vars);
      return {
        content: [
          {
            type: "text",
            text: `Set ${result.count} variable(s): ${result.set.join(", ")}`,
          },
        ],
      };
    },
  );

  server.tool(
    tools[12].name,
    tools[12].description,
    tools[12].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.env.list();
      return {
        content: [{ type: "text", text: JSON.stringify(result.vars, null, 2) }],
      };
    },
  );

  server.tool(
    tools[13].name,
    tools[13].description,
    tools[13].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.git.clone(args.url, {
        path: args.path,
        branch: args.branch,
        depth: args.depth,
      });
      const output = result.stderr
        ? `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
        : result.stdout;
      return {
        content: [{ type: "text", text: output }],
        isError: result.exitCode !== 0,
      };
    },
  );

  server.tool(
    tools[14].name,
    tools[14].description,
    tools[14].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const status = await sbx.git.status(args.path);
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      };
    },
  );

  server.tool(
    tools[15].name,
    tools[15].description,
    tools[15].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.git.commit(args.message, {
        path: args.path,
        all: args.all,
      });
      const output = result.stderr
        ? `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
        : result.stdout;
      return {
        content: [{ type: "text", text: output }],
        isError: result.exitCode !== 0,
      };
    },
  );

  server.tool(
    tools[16].name,
    tools[16].description,
    tools[16].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.git.diff({
        path: args.path,
        staged: args.staged,
      });
      return { content: [{ type: "text", text: result.diff || "(no diff)" }] };
    },
  );

  server.tool(
    tools[17].name,
    tools[17].description,
    tools[17].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.processes.list();
      return {
        content: [
          { type: "text", text: JSON.stringify(result.processes, null, 2) },
        ],
      };
    },
  );

  server.tool(
    tools[18].name,
    tools[18].description,
    tools[18].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.processes.kill(args.pid, args.signal);
      return {
        content: [
          {
            type: "text",
            text: `Killed PID ${result.killed} with signal ${result.signal}`,
          },
        ],
      };
    },
  );

  server.tool(
    tools[19].name,
    tools[19].description,
    tools[19].inputSchema.shape,
    async () => {
      const templates = await listTemplates(cfg);
      return {
        content: [{ type: "text", text: JSON.stringify(templates, null, 2) }],
      };
    },
  );

  server.tool(
    tools[20].name,
    tools[20].description,
    tools[20].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const snapshot = await sbx.snapshot(args.name);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );

  server.tool(
    tools[21].name,
    tools[21].description,
    tools[21].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.restore(args.snapshotId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    tools[22].name,
    tools[22].description,
    tools[22].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.listSnapshots();
      return {
        content: [
          { type: "text", text: JSON.stringify(result.snapshots, null, 2) },
        ],
      };
    },
  );

  server.tool(
    tools[23].name,
    tools[23].description,
    tools[23].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const cloned = await sbx.clone(args.name);
      return {
        content: [{ type: "text", text: JSON.stringify(cloned, null, 2) }],
      };
    },
  );

  server.tool(
    tools[24].name,
    tools[24].description,
    tools[24].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const mapping = await sbx.ports.expose(
        args.containerPort,
        args.hostPort,
        args.protocol,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(mapping, null, 2) }],
      };
    },
  );

  server.tool(
    tools[25].name,
    tools[25].description,
    tools[25].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.ports.list();
      return {
        content: [
          { type: "text", text: JSON.stringify(result.ports, null, 2) },
        ],
      };
    },
  );

  server.tool(
    tools[28].name,
    tools[28].description,
    tools[28].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const job = await sbx.queue.submit(args.command, {
        maxRetries: args.maxRetries,
        timeout: args.timeout,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
      };
    },
  );

  server.tool(
    tools[29].name,
    tools[29].description,
    tools[29].inputSchema.shape,
    async (args) => {
      const client = new HttpClient({ baseUrl: cfg.baseUrl, token: cfg.token });
      const job = await client.get(`/sandbox/queue/${args.jobId}/status`);
      return {
        content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
      };
    },
  );

  const events = new EventManager(
    new HttpClient({ baseUrl: cfg.baseUrl, token: cfg.token }),
  );

  server.tool(
    tools[26].name,
    tools[26].description,
    tools[26].inputSchema.shape,
    async (args) => {
      const result = await events.history({
        sandboxId: args.sandboxId,
        topic: args.topic,
        limit: args.limit,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    tools[27].name,
    tools[27].description,
    tools[27].inputSchema.shape,
    async (args) => {
      const event = await events.publish(
        args.topic,
        args.sandboxId,
        args.data as Record<string, unknown>,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(event, null, 2) }],
      };
    },
  );

  const networkMgr = new NetworkManager(
    new HttpClient({ baseUrl: cfg.baseUrl, token: cfg.token }),
  );

  server.tool(
    tools[30].name,
    tools[30].description,
    tools[30].inputSchema.shape,
    async (args) => {
      const result = await networkMgr.create(args.name, args.driver);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    tools[31].name,
    tools[31].description,
    tools[31].inputSchema.shape,
    async (args) => {
      const result = await networkMgr.connect(args.networkId, args.sandboxId);
      return {
        content: [
          {
            type: "text",
            text: `Connected sandbox ${args.sandboxId} to network ${args.networkId}`,
          },
        ],
      };
    },
  );

  server.tool(
    tools[32].name,
    tools[32].description,
    tools[32].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const logs: string[] = [];
      for await (const event of sbx.streams.logs({
        tail: args.tail,
        follow: false,
      })) {
        if (event.type === "end") break;
        logs.push(`[${event.type}] ${event.data}`);
      }
      return {
        content: [{ type: "text", text: logs.join("\n") || "(no logs)" }],
      };
    },
  );

  const observability = new ObservabilityClient(
    new HttpClient({ baseUrl: cfg.baseUrl, token: cfg.token }),
  );

  server.tool(
    tools[33].name,
    tools[33].description,
    tools[33].inputSchema.shape,
    async (args) => {
      const result = await observability.traces({
        sandboxId: args.sandboxId,
        functionId: args.functionId,
        limit: args.limit,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    tools[34].name,
    tools[34].description,
    tools[34].inputSchema.shape,
    async () => {
      const result = await observability.metrics();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    tools[35].name,
    tools[35].description,
    tools[35].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const alert = await sbx.monitor.setAlert(
        args.metric,
        args.threshold,
        args.action,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(alert, null, 2) }],
      };
    },
  );

  server.tool(
    tools[36].name,
    tools[36].description,
    tools[36].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.monitor.history(args.limit);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  const volumeMgr = new VolumeManager(
    new HttpClient({ baseUrl: cfg.baseUrl, token: cfg.token }),
  );

  server.tool(
    tools[37].name,
    tools[37].description,
    tools[37].inputSchema.shape,
    async (args) => {
      const result = await volumeMgr.create(args.name, args.driver);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    tools[38].name,
    tools[38].description,
    tools[38].inputSchema.shape,
    async (args) => {
      const result = await volumeMgr.attach(
        args.volumeId,
        args.sandboxId,
        args.mountPath,
      );
      return {
        content: [
          {
            type: "text",
            text: `Volume ${args.volumeId} attached to ${args.sandboxId} at ${args.mountPath}`,
          },
        ],
      };
    },
  );

  return server;
}
