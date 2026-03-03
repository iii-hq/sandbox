import type { SandboxConfig, ApiRequest, ApiResponse } from "../types.js";
import type { EngineConfig } from "../config.js";
import { resolve, normalize } from "node:path";

export function validatePath(path: string, workspaceDir: string): string {
  const normalized = normalize(resolve(workspaceDir, path));
  if (!normalized.startsWith(workspaceDir)) {
    throw new Error(`Path traversal detected: ${path}`);
  }
  return normalized;
}

export function validateSandboxConfig(input: unknown): SandboxConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid sandbox config");
  }
  const cfg = input as Record<string, unknown>;
  if (!cfg.image || typeof cfg.image !== "string") {
    throw new Error("image is required and must be a string");
  }
  if (cfg.image.includes("..") || cfg.image.includes("$")) {
    throw new Error("Invalid image name");
  }
  return {
    image: cfg.image,
    name: typeof cfg.name === "string" ? cfg.name : undefined,
    timeout:
      typeof cfg.timeout === "number"
        ? Math.min(Math.max(cfg.timeout, 60), 86400)
        : undefined,
    memory:
      typeof cfg.memory === "number"
        ? Math.min(Math.max(cfg.memory, 64), 4096)
        : undefined,
    cpu:
      typeof cfg.cpu === "number"
        ? Math.min(Math.max(cfg.cpu, 0.5), 4)
        : undefined,
    network: typeof cfg.network === "boolean" ? cfg.network : undefined,
    env:
      cfg.env && typeof cfg.env === "object"
        ? (cfg.env as Record<string, string>)
        : undefined,
    workdir: typeof cfg.workdir === "string" ? cfg.workdir : undefined,
    metadata:
      cfg.metadata && typeof cfg.metadata === "object"
        ? (cfg.metadata as Record<string, string>)
        : undefined,
    entrypoint: Array.isArray(cfg.entrypoint)
      ? (cfg.entrypoint as string[])
      : undefined,
  };
}

export function validateImageAllowed(
  image: string,
  allowed: string[],
): boolean {
  if (allowed.length === 1 && allowed[0] === "*") return true;
  return allowed.some((pattern) => {
    if (pattern.endsWith("*")) return image.startsWith(pattern.slice(0, -1));
    return image === pattern;
  });
}

export function checkAuth(
  req: ApiRequest,
  config: EngineConfig,
): ApiResponse | null {
  if (!config.authToken) return null;
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  if (!authHeader) {
    return {
      status_code: 401,
      body: { error: "Missing authorization header" },
    };
  }
  const token = authHeader.replace("Bearer ", "");
  if (token !== config.authToken) {
    return { status_code: 403, body: { error: "Invalid token" } };
  }
  return null;
}

export function validateCommand(command: string): string[] {
  if (!command || typeof command !== "string") {
    throw new Error("command is required");
  }
  return ["sh", "-c", command];
}
