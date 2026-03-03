import type { HttpClient } from "./client.js";
import type {
  SandboxInfo,
  ExecResult,
  ExecStreamChunk,
  SandboxMetrics,
} from "./types.js";
import { FileSystem } from "./filesystem.js";
import { CodeInterpreter } from "./interpreter.js";
import { parseExecStream } from "./stream.js";

export class Sandbox {
  readonly filesystem: FileSystem;
  readonly interpreter: CodeInterpreter;

  constructor(
    private client: HttpClient,
    public info: SandboxInfo,
  ) {
    this.filesystem = new FileSystem(client, info.id);
    this.interpreter = new CodeInterpreter(client, info.id);
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

  async refresh(): Promise<SandboxInfo> {
    const updated = await this.client.get<SandboxInfo>(
      `/sandbox/sandboxes/${this.info.id}`,
    );
    Object.assign(this.info, updated);
    return updated;
  }
}
