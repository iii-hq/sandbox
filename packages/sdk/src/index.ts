import { HttpClient } from "./client.js";
import { Sandbox } from "./sandbox.js";
import type {
  SandboxCreateOptions,
  SandboxInfo,
  SandboxTemplate,
  ClientConfig,
} from "./types.js";

export type {
  SandboxCreateOptions,
  SandboxInfo,
  SandboxTemplate,
  SnapshotInfo,
  ExecResult,
  ExecStreamChunk,
  FileInfo,
  SandboxMetrics,
  CodeResult,
  KernelSpec,
  ClientConfig,
} from "./types.js";

export { Sandbox } from "./sandbox.js";
export { EnvManager } from "./env.js";
export { FileSystem } from "./filesystem.js";
export { GitManager } from "./git.js";
export type { GitStatus, GitLogEntry, GitBranchResult } from "./git.js";
export { CodeInterpreter } from "./interpreter.js";
export { ProcessManager } from "./process.js";
export type { ProcessInfo, ProcessTopInfo } from "./process.js";
export { PortManager } from "./port.js";
export type { PortMapping } from "./port.js";
export { EventManager } from "./events.js";
export type { SandboxEvent } from "./events.js";
export { HttpClient } from "./client.js";
export { QueueManager } from "./queue.js";
export type { QueueJobInfo } from "./queue.js";
export { NetworkManager } from "./network.js";
export type { SandboxNetwork } from "./network.js";
export { StreamManager } from "./stream-manager.js";
export type { LogEvent } from "./stream-manager.js";
export { ObservabilityClient } from "./observability.js";
export type { TraceRecord, ObservabilityMetrics } from "./observability.js";
export { MonitorManager } from "./monitor.js";
export type { ResourceAlert, AlertEvent } from "./monitor.js";
export { VolumeManager } from "./volume.js";
export type { VolumeInfo } from "./volume.js";

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

export async function listTemplates(
  config?: ClientConfig,
): Promise<SandboxTemplate[]> {
  const client = new HttpClient({
    baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
    token: config?.token,
  });
  const res = await client.get<{ templates: SandboxTemplate[] }>(
    "/sandbox/templates",
  );
  return res.templates;
}
