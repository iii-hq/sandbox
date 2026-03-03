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

  wrap("interp::execute", "POST", "/sandboxes/:id/interpret/execute");
  wrap("interp::install", "POST", "/sandboxes/:id/interpret/install");
  wrap("interp::kernels", "GET", "/sandboxes/:id/interpret/kernels");

  wrap("metrics::sandbox", "GET", "/sandboxes/:id/metrics");
  wrap("metrics::global", "GET", "/metrics");

  wrap("lifecycle::health", "GET", "/health", false);
  wrap("lifecycle::ttl-sweep", "POST", "/admin/sweep");
}
