export interface SandboxConfig {
  image: string;
  name?: string;
  timeout?: number;
  memory?: number;
  cpu?: number;
  network?: boolean;
  env?: Record<string, string>;
  workdir?: string;
  metadata?: Record<string, string>;
  entrypoint?: string[];
}

export interface Sandbox {
  id: string;
  name: string;
  image: string;
  status: "creating" | "running" | "paused" | "stopped";
  createdAt: number;
  expiresAt: number;
  config: SandboxConfig;
  metadata: Record<string, string>;
  entrypoint?: string[];
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

export interface GlobalMetrics {
  activeSandboxes: number;
  totalCreated: number;
  totalKilled: number;
  totalExpired: number;
  uptimeSeconds: number;
}

export interface KernelSpec {
  name: string;
  language: string;
  displayName: string;
}

export interface CodeResult {
  output: string;
  error?: string;
  executionTime: number;
  mimeType?: string;
}

export type ApiRequest<T = unknown> = {
  path_params: Record<string, string>;
  query_params: Record<string, string | string[]>;
  body: T;
  headers: Record<string, string | string[]>;
  method: string;
};

export type ApiResponse<S extends number = number, B = unknown> = {
  status_code: S;
  headers?: Record<string, string>;
  body: B;
};

export interface ListOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  metadata?: Record<string, string>;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BackgroundExec {
  id: string;
  sandboxId: string;
  command: string;
  pid?: number;
  running: boolean;
  exitCode?: number;
  startedAt: number;
  finishedAt?: number;
}

export interface FileMetadata {
  path: string;
  size: number;
  permissions: string;
  owner: string;
  group: string;
  isDirectory: boolean;
  isSymlink: boolean;
  modifiedAt: number;
}

export interface CodeContext {
  id: string;
  language: string;
  sandboxId: string;
  createdAt: number;
}

export interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  config: SandboxConfig;
  builtin: boolean;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  sandboxId: string;
  name: string;
  imageId: string;
  size: number;
  createdAt: number;
}

export interface SandboxEvent {
  id: string;
  topic: string;
  sandboxId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface SandboxNetwork {
  id: string;
  name: string;
  dockerNetworkId: string;
  sandboxes: string[];
  createdAt: number;
}

export interface SandboxVolume {
  id: string;
  name: string;
  dockerVolumeName: string;
  mountPath?: string;
  sandboxId?: string;
  size?: string;
  createdAt: number;
}

export interface QueueJob {
  id: string;
  sandboxId: string;
  command: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: ExecResult;
  error?: string;
  retries: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ResourceAlert {
  id: string;
  sandboxId: string;
  metric: "cpu" | "memory" | "pids";
  threshold: number;
  action: "notify" | "pause" | "kill";
  triggered: boolean;
  lastChecked?: number;
  lastTriggered?: number;
  createdAt: number;
}

export interface AlertEvent {
  alertId: string;
  sandboxId: string;
  metric: string;
  value: number;
  threshold: number;
  action: string;
  timestamp: number;
}

export interface TraceRecord {
  id: string;
  functionId: string;
  sandboxId?: string;
  duration: number;
  status: "ok" | "error";
  error?: string;
  timestamp: number;
}

export interface ObservabilityMetrics {
  totalRequests: number;
  totalErrors: number;
  avgDuration: number;
  p95Duration: number;
  activeSandboxes: number;
  functionCounts: Record<string, number>;
}
