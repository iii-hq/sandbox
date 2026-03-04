import type { HttpClient } from "./client.js";

export interface SandboxEvent {
  id: string;
  topic: string;
  sandboxId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export class EventManager {
  constructor(private client: HttpClient) {}

  async history(options?: {
    sandboxId?: string;
    topic?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ events: SandboxEvent[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.sandboxId) params.set("sandboxId", options.sandboxId);
    if (options?.topic) params.set("topic", options.topic);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    const path = `/sandbox/events/history${qs ? `?${qs}` : ""}`;
    return this.client.get(path);
  }

  async publish(
    topic: string,
    sandboxId: string,
    data?: Record<string, unknown>,
  ): Promise<SandboxEvent> {
    return this.client.post("/sandbox/events/publish", {
      topic,
      sandboxId,
      data,
    });
  }
}
