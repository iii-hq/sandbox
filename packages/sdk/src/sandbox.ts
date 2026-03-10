import type { HttpClient } from "./client.js";
import type {
  SandboxInfo,
  ExecResult,
  ExecStreamChunk,
  SandboxMetrics,
  SnapshotInfo,
} from "./types.js";
import { EnvManager } from "./env.js";
import { FileSystem } from "./filesystem.js";
import { GitManager } from "./git.js";
import { CodeInterpreter } from "./interpreter.js";
import { ProcessManager } from "./process.js";
import { PortManager } from "./port.js";
import { QueueManager } from "./queue.js";
import { StreamManager } from "./stream-manager.js";
import { MonitorManager } from "./monitor.js";
import { TerminalManager } from "./terminal.js";
import { parseExecStream } from "./stream.js";

export class Sandbox {
  readonly env: EnvManager;
  readonly filesystem: FileSystem;
  readonly git: GitManager;
  readonly interpreter: CodeInterpreter;
  readonly processes: ProcessManager;
  readonly ports: PortManager;
  readonly queue: QueueManager;
  readonly streams: StreamManager;
  readonly monitor: MonitorManager;
  readonly terminal: TerminalManager;

  constructor(
    private client: HttpClient,
    public info: SandboxInfo,
  ) {
    this.env = new EnvManager(client, info.id);
    this.filesystem = new FileSystem(client, info.id);
    this.git = new GitManager(client, info.id);
    this.interpreter = new CodeInterpreter(client, info.id);
    this.processes = new ProcessManager(client, info.id);
    this.ports = new PortManager(client, info.id);
    this.queue = new QueueManager(client, info.id);
    this.streams = new StreamManager(client, info.id);
    this.monitor = new MonitorManager(client, info.id);
    this.terminal = new TerminalManager(client, info.id);
  }

  get id(): string {
    return this.info.id;
  }

  get status(): string {
    return this.info.status;
  }

  async exec(command: string, timeout?: number): Promise<ExecResult> {
    return this.client.post<ExecResult>(
      `/sandbox/sandboxes/${this.info.id}/exec`,
      { command, timeout },
    );
  }

  async *execStream(command: string): AsyncGenerator<ExecStreamChunk> {
    const lines = this.client.stream(
      `/sandbox/sandboxes/${this.info.id}/exec/stream`,
      { command },
    );
    yield* parseExecStream(lines);
  }

  async clone(name?: string): Promise<SandboxInfo> {
    return this.client.post<SandboxInfo>(
      `/sandbox/sandboxes/${this.info.id}/clone`,
      { name },
    );
  }

  async pause(): Promise<void> {
    await this.client.post(`/sandbox/sandboxes/${this.info.id}/pause`);
  }

  async resume(): Promise<void> {
    await this.client.post(`/sandbox/sandboxes/${this.info.id}/resume`);
  }

  async kill(): Promise<void> {
    await this.client.del(`/sandbox/sandboxes/${this.info.id}`);
  }

  async metrics(): Promise<SandboxMetrics> {
    return this.client.get<SandboxMetrics>(
      `/sandbox/sandboxes/${this.info.id}/metrics`,
    );
  }

  async snapshot(name?: string): Promise<SnapshotInfo> {
    return this.client.post<SnapshotInfo>(
      `/sandbox/sandboxes/${this.info.id}/snapshots`,
      { name },
    );
  }

  async restore(snapshotId: string): Promise<SandboxInfo> {
    return this.client.post<SandboxInfo>(
      `/sandbox/sandboxes/${this.info.id}/snapshots/restore`,
      { snapshotId },
    );
  }

  async listSnapshots(): Promise<{ snapshots: SnapshotInfo[] }> {
    return this.client.get<{ snapshots: SnapshotInfo[] }>(
      `/sandbox/sandboxes/${this.info.id}/snapshots`,
    );
  }

  async refresh(): Promise<SandboxInfo> {
    const updated = await this.client.get<SandboxInfo>(
      `/sandbox/sandboxes/${this.info.id}`,
    );
    Object.assign(this.info, updated);
    return updated;
  }
}
