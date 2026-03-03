import type { EngineConfig } from "../config.js";
import type { ApiRequest, ApiResponse } from "../types.js";
import { checkAuth } from "../security/validate.js";

export function registerApiTriggers(sdk: any, config: EngineConfig) {
  const p = config.apiPrefix;

  const wrap = (
    fnId: string,
    method: string,
    path: string,
    requireAuth = true,
  ) => {
    const wrappedId = `api::${fnId}`;

    sdk.registerFunction(
      { id: wrappedId },
      async (req: ApiRequest): Promise<ApiResponse> => {
        if (requireAuth) {
          const authErr = checkAuth(req, config);
          if (authErr) return authErr;
        }
        try {
          const merged = Object.assign(
            {},
            req.query_params as Record<string, unknown>,
            req.body as Record<string, unknown>,
            req.path_params as Record<string, unknown>,
          );
          const result = await sdk.trigger(fnId, merged);
          return { status_code: 200, body: result };
        } catch (err: any) {
          const msg = err?.message ?? "Internal error";
          let code = 500;
          if (msg.includes("not found")) code = 404;
          else if (msg.includes("not allowed")) code = 403;
          return { status_code: code, body: { error: msg } };
        }
      },
    );

    sdk.registerTrigger({
      type: "http",
      function_id: wrappedId,
      config: { api_path: `${p}${path}`, http_method: method },
    });
  };

  wrap("sandbox::create", "POST", "/sandboxes");
  wrap("sandbox::list", "GET", "/sandboxes");
  wrap("sandbox::get", "GET", "/sandboxes/:id");
  wrap("sandbox::kill", "DELETE", "/sandboxes/:id");
  wrap("sandbox::pause", "POST", "/sandboxes/:id/pause");
  wrap("sandbox::resume", "POST", "/sandboxes/:id/resume");
  wrap("sandbox::renew", "POST", "/sandboxes/:id/renew");
  wrap("sandbox::clone", "POST", "/sandboxes/:id/clone");

  wrap("cmd::run", "POST", "/sandboxes/:id/exec");
  wrap("cmd::background", "POST", "/sandboxes/:id/exec/background");

  sdk.registerTrigger({
    type: "http",
    function_id: "cmd::run-stream",
    config: {
      api_path: `${p}/sandboxes/:id/exec/stream`,
      http_method: "POST",
    },
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

  wrap("env::get", "POST", "/sandboxes/:id/env/get");
  wrap("env::set", "POST", "/sandboxes/:id/env");
  wrap("env::list", "GET", "/sandboxes/:id/env");
  wrap("env::delete", "POST", "/sandboxes/:id/env/delete");

  wrap("git::clone", "POST", "/sandboxes/:id/git/clone");
  wrap("git::status", "GET", "/sandboxes/:id/git/status");
  wrap("git::commit", "POST", "/sandboxes/:id/git/commit");
  wrap("git::diff", "GET", "/sandboxes/:id/git/diff");
  wrap("git::log", "GET", "/sandboxes/:id/git/log");
  wrap("git::branch", "POST", "/sandboxes/:id/git/branch");
  wrap("git::checkout", "POST", "/sandboxes/:id/git/checkout");
  wrap("git::push", "POST", "/sandboxes/:id/git/push");
  wrap("git::pull", "POST", "/sandboxes/:id/git/pull");

  wrap("proc::list", "GET", "/sandboxes/:id/processes");
  wrap("proc::kill", "POST", "/sandboxes/:id/processes/kill");
  wrap("proc::top", "GET", "/sandboxes/:id/processes/top");

  wrap("port::expose", "POST", "/sandboxes/:id/ports");
  wrap("port::list", "GET", "/sandboxes/:id/ports");
  wrap("port::unexpose", "DELETE", "/sandboxes/:id/ports");

  wrap("snapshot::create", "POST", "/sandboxes/:id/snapshots");
  wrap("snapshot::list", "GET", "/sandboxes/:id/snapshots");
  wrap("snapshot::restore", "POST", "/sandboxes/:id/snapshots/restore");
  wrap("snapshot::delete", "DELETE", "/snapshots/:snapshotId");

  wrap("template::create", "POST", "/templates");
  wrap("template::list", "GET", "/templates");
  wrap("template::get", "GET", "/templates/:id");
  wrap("template::delete", "DELETE", "/templates/:id");

  wrap("interp::execute", "POST", "/sandboxes/:id/interpret/execute");
  wrap("interp::install", "POST", "/sandboxes/:id/interpret/install");
  wrap("interp::kernels", "GET", "/sandboxes/:id/interpret/kernels");

  wrap("metrics::sandbox", "GET", "/sandboxes/:id/metrics");
  wrap("metrics::global", "GET", "/metrics");

  wrap("event::history", "GET", "/events/history");
  wrap("event::publish", "POST", "/events/publish");

  wrap("queue::submit", "POST", "/sandboxes/:id/exec/queue");
  wrap("queue::status", "GET", "/queue/:jobId/status");
  wrap("queue::cancel", "POST", "/queue/:jobId/cancel");
  wrap("queue::dlq", "GET", "/queue/dlq");

  wrap("network::create", "POST", "/networks");
  wrap("network::list", "GET", "/networks");
  wrap("network::connect", "POST", "/networks/:networkId/connect");
  wrap("network::disconnect", "POST", "/networks/:networkId/disconnect");
  wrap("network::delete", "DELETE", "/networks/:networkId");

  wrap("observability::traces", "GET", "/observability/traces");
  wrap("observability::metrics", "GET", "/observability/metrics");
  wrap("observability::clear", "POST", "/observability/clear");

  sdk.registerTrigger({
    type: "http",
    function_id: "stream::logs",
    config: { api_path: `${p}/sandboxes/:id/stream/logs`, http_method: "GET" },
  });
  sdk.registerTrigger({
    type: "http",
    function_id: "stream::metrics",
    config: {
      api_path: `${p}/sandboxes/:id/stream/metrics`,
      http_method: "GET",
    },
  });
  sdk.registerTrigger({
    type: "http",
    function_id: "stream::events",
    config: { api_path: `${p}/stream/events`, http_method: "GET" },
  });

  wrap("monitor::set-alert", "POST", "/sandboxes/:id/alerts");
  wrap("monitor::list-alerts", "GET", "/sandboxes/:id/alerts");
  wrap("monitor::delete-alert", "DELETE", "/alerts/:alertId");
  wrap("monitor::history", "GET", "/sandboxes/:id/alerts/history");

  wrap("volume::create", "POST", "/volumes");
  wrap("volume::list", "GET", "/volumes");
  wrap("volume::delete", "DELETE", "/volumes/:volumeId");
  wrap("volume::attach", "POST", "/volumes/:volumeId/attach");
  wrap("volume::detach", "POST", "/volumes/:volumeId/detach");

  wrap("lifecycle::health", "GET", "/health", false);
  wrap("lifecycle::ttl-sweep", "POST", "/admin/sweep");
}
