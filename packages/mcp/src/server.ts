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

const toolMap: Record<string, (typeof tools)[number]> = Object.fromEntries(
  tools.map((t) => [t.name, t]),
);

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

  const t = toolMap;

  server.tool(
    t["sandbox_create"].name,
    t["sandbox_create"].description,
    t["sandbox_create"].inputSchema.shape,
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
    t["sandbox_exec"].name,
    t["sandbox_exec"].description,
    t["sandbox_exec"].inputSchema.shape,
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
    t["sandbox_run_code"].name,
    t["sandbox_run_code"].description,
    t["sandbox_run_code"].inputSchema.shape,
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
    t["sandbox_read_file"].name,
    t["sandbox_read_file"].description,
    t["sandbox_read_file"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const content = await sbx.filesystem.read(args.path);
      return { content: [{ type: "text", text: content }] };
    },
  );

  server.tool(
    t["sandbox_write_file"].name,
    t["sandbox_write_file"].description,
    t["sandbox_write_file"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      await sbx.filesystem.write(args.path, args.content);
      return { content: [{ type: "text", text: `Written to ${args.path}` }] };
    },
  );

  server.tool(
    t["sandbox_list_files"].name,
    t["sandbox_list_files"].description,
    t["sandbox_list_files"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const files = await sbx.filesystem.list(args.path);
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_install_package"].name,
    t["sandbox_install_package"].description,
    t["sandbox_install_package"].inputSchema.shape,
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
    t["sandbox_list"].name,
    t["sandbox_list"].description,
    t["sandbox_list"].inputSchema.shape,
    async () => {
      const sandboxes = await listSandboxes(cfg);
      return {
        content: [{ type: "text", text: JSON.stringify(sandboxes, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_kill"].name,
    t["sandbox_kill"].description,
    t["sandbox_kill"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      await sbx.kill();
      return {
        content: [{ type: "text", text: `Sandbox ${args.sandboxId} killed` }],
      };
    },
  );

  server.tool(
    t["sandbox_metrics"].name,
    t["sandbox_metrics"].description,
    t["sandbox_metrics"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const metrics = await sbx.metrics();
      return {
        content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_env_get"].name,
    t["sandbox_env_get"].description,
    t["sandbox_env_get"].inputSchema.shape,
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
    t["sandbox_env_set"].name,
    t["sandbox_env_set"].description,
    t["sandbox_env_set"].inputSchema.shape,
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
    t["sandbox_env_list"].name,
    t["sandbox_env_list"].description,
    t["sandbox_env_list"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.env.list();
      return {
        content: [{ type: "text", text: JSON.stringify(result.vars, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_git_clone"].name,
    t["sandbox_git_clone"].description,
    t["sandbox_git_clone"].inputSchema.shape,
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
    t["sandbox_git_status"].name,
    t["sandbox_git_status"].description,
    t["sandbox_git_status"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const status = await sbx.git.status(args.path);
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_git_commit"].name,
    t["sandbox_git_commit"].description,
    t["sandbox_git_commit"].inputSchema.shape,
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
    t["sandbox_git_diff"].name,
    t["sandbox_git_diff"].description,
    t["sandbox_git_diff"].inputSchema.shape,
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
    t["sandbox_process_list"].name,
    t["sandbox_process_list"].description,
    t["sandbox_process_list"].inputSchema.shape,
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
    t["sandbox_process_kill"].name,
    t["sandbox_process_kill"].description,
    t["sandbox_process_kill"].inputSchema.shape,
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
    t["sandbox_template_list"].name,
    t["sandbox_template_list"].description,
    t["sandbox_template_list"].inputSchema.shape,
    async () => {
      const templates = await listTemplates(cfg);
      return {
        content: [{ type: "text", text: JSON.stringify(templates, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_snapshot_create"].name,
    t["sandbox_snapshot_create"].description,
    t["sandbox_snapshot_create"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const snapshot = await sbx.snapshot(args.name);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_snapshot_restore"].name,
    t["sandbox_snapshot_restore"].description,
    t["sandbox_snapshot_restore"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const result = await sbx.restore(args.snapshotId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_snapshot_list"].name,
    t["sandbox_snapshot_list"].description,
    t["sandbox_snapshot_list"].inputSchema.shape,
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
    t["sandbox_clone"].name,
    t["sandbox_clone"].description,
    t["sandbox_clone"].inputSchema.shape,
    async (args) => {
      const sbx = await getSandbox(args.sandboxId, cfg);
      const cloned = await sbx.clone(args.name);
      return {
        content: [{ type: "text", text: JSON.stringify(cloned, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_port_expose"].name,
    t["sandbox_port_expose"].description,
    t["sandbox_port_expose"].inputSchema.shape,
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
    t["sandbox_port_list"].name,
    t["sandbox_port_list"].description,
    t["sandbox_port_list"].inputSchema.shape,
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
    t["sandbox_exec_queue"].name,
    t["sandbox_exec_queue"].description,
    t["sandbox_exec_queue"].inputSchema.shape,
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
    t["sandbox_queue_status"].name,
    t["sandbox_queue_status"].description,
    t["sandbox_queue_status"].inputSchema.shape,
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
    t["sandbox_events_history"].name,
    t["sandbox_events_history"].description,
    t["sandbox_events_history"].inputSchema.shape,
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
    t["sandbox_events_publish"].name,
    t["sandbox_events_publish"].description,
    t["sandbox_events_publish"].inputSchema.shape,
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
    t["sandbox_network_create"].name,
    t["sandbox_network_create"].description,
    t["sandbox_network_create"].inputSchema.shape,
    async (args) => {
      const result = await networkMgr.create(args.name, args.driver);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_network_connect"].name,
    t["sandbox_network_connect"].description,
    t["sandbox_network_connect"].inputSchema.shape,
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
    t["sandbox_stream_logs"].name,
    t["sandbox_stream_logs"].description,
    t["sandbox_stream_logs"].inputSchema.shape,
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
    t["sandbox_traces"].name,
    t["sandbox_traces"].description,
    t["sandbox_traces"].inputSchema.shape,
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
    t["sandbox_metrics_dashboard"].name,
    t["sandbox_metrics_dashboard"].description,
    t["sandbox_metrics_dashboard"].inputSchema.shape,
    async () => {
      const result = await observability.metrics();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_set_alert"].name,
    t["sandbox_set_alert"].description,
    t["sandbox_set_alert"].inputSchema.shape,
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
    t["sandbox_alert_history"].name,
    t["sandbox_alert_history"].description,
    t["sandbox_alert_history"].inputSchema.shape,
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
    t["sandbox_volume_create"].name,
    t["sandbox_volume_create"].description,
    t["sandbox_volume_create"].inputSchema.shape,
    async (args) => {
      const result = await volumeMgr.create(args.name, args.driver);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    t["sandbox_volume_attach"].name,
    t["sandbox_volume_attach"].description,
    t["sandbox_volume_attach"].inputSchema.shape,
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
