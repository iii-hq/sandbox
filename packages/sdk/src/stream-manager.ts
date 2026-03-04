import type { HttpClient } from "./client.js";
import type { SandboxMetrics } from "./types.js";

export interface LogEvent {
  type: "stdout" | "stderr" | "end";
  data: string;
  timestamp: number;
}

export class StreamManager {
  constructor(
    private client: HttpClient,
    private sandboxId: string,
  ) {}

  async *logs(options?: {
    tail?: number;
    follow?: boolean;
  }): AsyncGenerator<LogEvent> {
    const params = new URLSearchParams();
    if (options?.tail !== undefined) params.set("tail", String(options.tail));
    if (options?.follow !== undefined)
      params.set("follow", String(options.follow));
    const qs = params.toString();
    const path = `/sandbox/sandboxes/${this.sandboxId}/stream/logs${qs ? `?${qs}` : ""}`;
    const lines = this.client.streamGet(path);
    for await (const line of lines) {
      try {
        const event = JSON.parse(line) as LogEvent;
        yield event;
        if (event.type === "end") return;
      } catch {
        continue;
      }
    }
  }

  async *metrics(interval?: number): AsyncGenerator<SandboxMetrics> {
    const params = new URLSearchParams();
    if (interval !== undefined) params.set("interval", String(interval));
    const qs = params.toString();
    const path = `/sandbox/sandboxes/${this.sandboxId}/stream/metrics${qs ? `?${qs}` : ""}`;
    const lines = this.client.streamGet(path);
    for await (const line of lines) {
      try {
        yield JSON.parse(line) as SandboxMetrics;
      } catch {
        continue;
      }
    }
  }
}
