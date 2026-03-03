export interface EngineConfig {
  engineUrl: string;
  workerName: string;
  restPort: number;
  apiPrefix: string;
  authToken: string | null;
  defaultImage: string;
  defaultTimeout: number;
  defaultMemory: number;
  defaultCpu: number;
  maxSandboxes: number;
  ttlSweepInterval: string;
  metricsInterval: string;
  allowedImages: string[];
  workspaceDir: string;
  maxCommandTimeout: number;
}

function parseIntOrDefault(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = parseInt(value ?? String(fallback), 10);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

export function loadConfig(): EngineConfig {
  return {
    engineUrl: process.env.III_ENGINE_URL ?? "ws://localhost:49134",
    workerName: process.env.III_WORKER_NAME ?? "iii-sandbox",
    restPort: parseIntOrDefault(process.env.III_REST_PORT, 3111),
    apiPrefix: process.env.III_API_PREFIX ?? "/sandbox",
    authToken: process.env.III_AUTH_TOKEN ?? null,
    defaultImage: process.env.III_DEFAULT_IMAGE ?? "python:3.12-slim",
    defaultTimeout: parseIntOrDefault(process.env.III_DEFAULT_TIMEOUT, 3600),
    defaultMemory: parseIntOrDefault(process.env.III_DEFAULT_MEMORY, 512),
    defaultCpu: parseIntOrDefault(process.env.III_DEFAULT_CPU, 1),
    maxSandboxes: parseIntOrDefault(process.env.III_MAX_SANDBOXES, 50),
    ttlSweepInterval: process.env.III_TTL_SWEEP ?? "*/30 * * * * *",
    metricsInterval: process.env.III_METRICS_INTERVAL ?? "*/60 * * * * *",
    allowedImages: (process.env.III_ALLOWED_IMAGES ?? "*")
      .split(",")
      .map((s) => s.trim()),
    workspaceDir: process.env.III_WORKSPACE_DIR ?? "/workspace",
    maxCommandTimeout: parseIntOrDefault(process.env.III_MAX_CMD_TIMEOUT, 300),
  };
}
