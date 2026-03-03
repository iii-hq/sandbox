export interface SandboxCreateOptions {
  image?: string;
  name?: string;
  timeout?: number;
  memory?: number;
  cpu?: number;
  network?: boolean;
  env?: Record<string, string>;
  workdir?: string;
  template?: string;
}

export interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  builtin: boolean;
  createdAt: number;
}

export interface SandboxInfo {
  id: string;
  name: string;
  image: string;
  status: "creating" | "running" | "paused" | "stopped";
  createdAt: number;
  expiresAt: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface ExecStreamChunk {
  type: "stdout" | "stderr" | "exit";
  data: string;
  timestamp: number;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
}

export interface SandboxMetrics {
  sandboxId: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  networkRxBytes: number;
  networkTxBytes: number;
  pids: number;
}

export interface CodeResult {
  output: string;
  error?: string;
  executionTime: number;
  mimeType?: string;
}

export interface KernelSpec {
  name: string;
  language: string;
  displayName: string;
}

export interface SnapshotInfo {
  id: string;
  sandboxId: string;
  name: string;
  imageId: string;
  size: number;
  createdAt: number;
}

export interface ClientConfig {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}
