import { HttpClient } from "./client.js";
import { Sandbox } from "./sandbox.js";
import type {
  SandboxCreateOptions,
  SandboxInfo,
  ClientConfig,
} from "./types.js";

export type {
  SandboxCreateOptions,
  SandboxInfo,
  ExecResult,
  ExecStreamChunk,
  FileInfo,
  SandboxMetrics,
  CodeResult,
  KernelSpec,
  ClientConfig,
} from "./types.js";

export { Sandbox } from "./sandbox.js";
export { FileSystem } from "./filesystem.js";
export { CodeInterpreter } from "./interpreter.js";

const DEFAULT_BASE_URL = "http://localhost:3111";

export async function createSandbox(
  options: SandboxCreateOptions & { baseUrl?: string; token?: string } = {},
): Promise<Sandbox> {
  const { baseUrl, token, ...config } = options;
  const client = new HttpClient({
    baseUrl: baseUrl ?? DEFAULT_BASE_URL,
    token,
  });
  const info = await client.post<SandboxInfo>("/sandbox/sandboxes", {
    image: config.image ?? "python:3.12-slim",
    ...config,
  });
  return new Sandbox(client, info);
}

export async function listSandboxes(
  config?: ClientConfig,
): Promise<SandboxInfo[]> {
  const client = new HttpClient({
    baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
    token: config?.token,
  });
  const res = await client.get<{ items: SandboxInfo[] }>("/sandbox/sandboxes");
  return res.items;
}

export async function getSandbox(
  id: string,
  config?: ClientConfig,
): Promise<Sandbox> {
  const client = new HttpClient({
    baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
    token: config?.token,
  });
  const info = await client.get<SandboxInfo>(`/sandbox/sandboxes/${id}`);
  return new Sandbox(client, info);
}
