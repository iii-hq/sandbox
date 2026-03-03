import { getContext, http } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import { getDocker, getContainerStats } from "../docker/client.js";
import { checkAuth } from "../security/validate.js";
import type { Sandbox, SandboxEvent } from "../types.js";

export function registerStreamFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  const getRunningContainer = async (id: string) => {
    const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, id);
    if (!sandbox) throw new Error(`Sandbox not found: ${id}`);
    if (sandbox.status !== "running")
      throw new Error(`Sandbox is not running: ${sandbox.status}`);
    return getDocker().getContainer(`iii-sbx-${id}`);
  };

  sdk.registerFunction(
    { id: "stream::logs", description: "Stream container logs via SSE" },
    http(async (req, res) => {
      const authErr = checkAuth(req as any, config);
      if (authErr) {
        res.status(authErr.status_code);
        res.stream.write(JSON.stringify(authErr.body));
        res.close();
        return;
      }

      const id = req.path_params?.id;
      const follow = req.query_params?.follow !== "false";
      const tail = parseInt(req.query_params?.tail as string, 10) || 100;

      let container;
      try {
        container = await getRunningContainer(id);
      } catch (err: any) {
        const msg = err.message ?? "Internal error";
        const code = msg.includes("not found") ? 404 : 400;
        res.status(code);
        res.stream.write(JSON.stringify({ error: msg }));
        res.close();
        return;
      }

      const ctx = getContext();
      ctx.logger.info("Streaming logs", { id, follow, tail });

      res.status(200);
      res.headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        const logStream = await container.logs({
          follow,
          stdout: true,
          stderr: true,
          tail,
          timestamps: true,
        });

        if (follow && typeof logStream.on === "function") {
          logStream.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split("\n").filter(Boolean);
            for (const line of lines) {
              const header = line.charCodeAt(0);
              const text = line.length > 8 ? line.slice(8) : line;
              res.stream.write(
                `data: ${JSON.stringify({
                  type: header === 2 ? "stderr" : "stdout",
                  data: text,
                  timestamp: Date.now(),
                })}\n\n`,
              );
            }
          });

          logStream.on("end", () => {
            res.stream.write(
              `data: ${JSON.stringify({ type: "end", data: "", timestamp: Date.now() })}\n\n`,
            );
            res.close();
          });

          logStream.on("error", () => {
            res.close();
          });
        } else {
          const output = typeof logStream === "string" ? logStream : logStream.toString();
          const lines = output.split("\n").filter(Boolean);
          for (const line of lines) {
            const header = line.charCodeAt(0);
            const text = line.length > 8 ? line.slice(8) : line;
            res.stream.write(
              `data: ${JSON.stringify({
                type: header === 2 ? "stderr" : "stdout",
                data: text,
                timestamp: Date.now(),
              })}\n\n`,
            );
          }
          res.stream.write(
            `data: ${JSON.stringify({ type: "end", data: "", timestamp: Date.now() })}\n\n`,
          );
          res.close();
        }
      } catch {
        res.close();
      }
    }),
  );

  sdk.registerFunction(
    { id: "stream::metrics", description: "Stream container metrics via SSE" },
    http(async (req, res) => {
      const authErr = checkAuth(req as any, config);
      if (authErr) {
        res.status(authErr.status_code);
        res.stream.write(JSON.stringify(authErr.body));
        res.close();
        return;
      }

      const id = req.path_params?.id;
      const interval = Math.max(
        parseInt(req.query_params?.interval as string, 10) || 5,
        1,
      );

      let container;
      try {
        container = await getRunningContainer(id);
      } catch (err: any) {
        const msg = err.message ?? "Internal error";
        const code = msg.includes("not found") ? 404 : 400;
        res.status(code);
        res.stream.write(JSON.stringify({ error: msg }));
        res.close();
        return;
      }

      const ctx = getContext();
      ctx.logger.info("Streaming metrics", { id, interval });

      res.status(200);
      res.headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const stats = await getContainerStats(container);
          res.stream.write(`data: ${JSON.stringify(stats)}\n\n`);
        } catch {
          stopped = true;
          res.stream.write(
            `data: ${JSON.stringify({ type: "error", error: "Container stopped", timestamp: Date.now() })}\n\n`,
          );
          res.close();
          return;
        }
        if (!stopped) timer = setTimeout(tick, interval * 1000);
      };

      let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 0);

      req.on?.("close", () => {
        stopped = true;
        clearTimeout(timer);
        res.close();
      });
    }),
  );

  sdk.registerFunction(
    { id: "stream::events", description: "Stream sandbox events via SSE" },
    http(async (req, res) => {
      const authErr = checkAuth(req as any, config);
      if (authErr) {
        res.status(authErr.status_code);
        res.stream.write(JSON.stringify(authErr.body));
        res.close();
        return;
      }

      const topic = req.query_params?.topic as string | undefined;

      const ctx = getContext();
      ctx.logger.info("Streaming events", { topic });

      res.status(200);
      res.headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let lastTimestamp = Date.now();
      let stopped = false;

      const poll = async () => {
        if (stopped) return;
        try {
          let events = await kv.list<SandboxEvent>(SCOPES.EVENTS);
          events = events.filter((e) => e.timestamp > lastTimestamp);
          if (topic) events = events.filter((e) => e.topic === topic);
          events.sort((a, b) => a.timestamp - b.timestamp);

          for (const event of events) {
            res.stream.write(`data: ${JSON.stringify(event)}\n\n`);
            lastTimestamp = event.timestamp;
          }
        } catch {
          stopped = true;
          res.close();
          return;
        }
        if (!stopped) timer = setTimeout(poll, 2000);
      };

      let timer: ReturnType<typeof setTimeout> = setTimeout(poll, 0);

      req.on?.("close", () => {
        stopped = true;
        clearTimeout(timer);
        res.close();
      });
    }),
  );
}
