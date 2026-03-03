//#region src/types.d.ts
interface SandboxCreateOptions {
  image?: string;
  name?: string;
  timeout?: number;
  memory?: number;
  cpu?: number;
  network?: boolean;
  env?: Record<string, string>;
  workdir?: string;
}
interface SandboxInfo {
  id: string;
  name: string;
  image: string;
  status: "creating" | "running" | "paused" | "stopped";
  createdAt: number;
  expiresAt: number;
}
interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}
interface ExecStreamChunk {
  type: "stdout" | "stderr" | "exit";
  data: string;
  timestamp: number;
}
interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
}
interface SandboxMetrics {
  sandboxId: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  networkRxBytes: number;
  networkTxBytes: number;
  pids: number;
}
interface CodeResult {
  output: string;
  error?: string;
  executionTime: number;
  mimeType?: string;
}
interface KernelSpec {
  name: string;
  language: string;
  displayName: string;
}
interface ClientConfig {
  baseUrl: string;
  token?: string;
}
//# sourceMappingURL=types.d.ts.map
//#endregion
//#region src/client.d.ts
declare class HttpClient {
  private baseUrl;
  private token?;
  constructor(config: ClientConfig);
  private headers;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  stream(path: string, body?: unknown): AsyncGenerator<string>;
  private readSSE;
}
//# sourceMappingURL=client.d.ts.map
//#endregion
//#region src/filesystem.d.ts
declare class FileSystem {
  private client;
  private sandboxId;
  constructor(client: HttpClient, sandboxId: string);
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(path?: string): Promise<FileInfo[]>;
  search(pattern: string, dir?: string): Promise<string[]>;
  upload(path: string, content: string): Promise<void>;
  download(path: string): Promise<string>;
}
//# sourceMappingURL=filesystem.d.ts.map
//#endregion
//#region src/interpreter.d.ts
declare class CodeInterpreter {
  private client;
  private sandboxId;
  constructor(client: HttpClient, sandboxId: string);
  run(code: string, language?: string): Promise<CodeResult>;
  install(packages: string[], manager?: "pip" | "npm" | "go"): Promise<string>;
  kernels(): Promise<KernelSpec[]>;
}
//# sourceMappingURL=interpreter.d.ts.map
//#endregion
//#region src/sandbox.d.ts
declare class Sandbox {
  private client;
  info: SandboxInfo;
  readonly filesystem: FileSystem;
  readonly interpreter: CodeInterpreter;
  constructor(client: HttpClient, info: SandboxInfo);
  get id(): string;
  get status(): string;
  exec(command: string, timeout?: number): Promise<ExecResult>;
  execStream(command: string): AsyncGenerator<ExecStreamChunk>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  kill(): Promise<void>;
  metrics(): Promise<SandboxMetrics>;
  refresh(): Promise<SandboxInfo>;
}
//# sourceMappingURL=sandbox.d.ts.map
//#endregion
//#region src/index.d.ts
declare function createSandbox(options?: SandboxCreateOptions & {
  baseUrl?: string;
  token?: string;
}): Promise<Sandbox>;
declare function listSandboxes(config?: ClientConfig): Promise<SandboxInfo[]>;
declare function getSandbox(id: string, config?: ClientConfig): Promise<Sandbox>;
//# sourceMappingURL=index.d.ts.map

//#endregion
export { type ClientConfig, CodeInterpreter, type CodeResult, type ExecResult, type ExecStreamChunk, type FileInfo, FileSystem, type KernelSpec, Sandbox, type SandboxCreateOptions, type SandboxInfo, type SandboxMetrics, createSandbox, getSandbox, listSandboxes };
//# sourceMappingURL=index-CBP5zywA.d.ts.map