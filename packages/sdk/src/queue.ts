import type { HttpClient } from "./client.js";

export interface QueueJobInfo {
  id: string;
  sandboxId: string;
  command: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: { exitCode: number; stdout: string; stderr: string; duration: number };
  error?: string;
  retries: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export class QueueManager {
  constructor(private client: HttpClient, private sandboxId: string) {}

  async submit(command: string, options?: { maxRetries?: number; timeout?: number }): Promise<QueueJobInfo> {
    return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/exec/queue`, { command, ...options });
  }

  async status(jobId: string): Promise<QueueJobInfo> {
    return this.client.get(`/sandbox/queue/${jobId}/status`);
  }

  async cancel(jobId: string): Promise<{ cancelled: string }> {
    return this.client.post(`/sandbox/queue/${jobId}/cancel`);
  }

  async dlq(limit?: number): Promise<{ jobs: QueueJobInfo[]; total: number }> {
    return this.client.get(`/sandbox/queue/dlq${limit ? `?limit=${limit}` : ""}`);
  }
}
