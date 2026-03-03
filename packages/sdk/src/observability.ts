import type { HttpClient } from "./client.js";

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

export class ObservabilityClient {
  constructor(private client: HttpClient) {}

  async traces(options?: {
    sandboxId?: string;
    functionId?: string;
    limit?: number;
  }): Promise<{ traces: TraceRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.sandboxId) params.set("sandboxId", options.sandboxId);
    if (options?.functionId) params.set("functionId", options.functionId);
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.client.get(`/sandbox/observability/traces${qs ? `?${qs}` : ""}`);
  }

  async metrics(): Promise<ObservabilityMetrics> {
    return this.client.get("/sandbox/observability/metrics");
  }

  async clear(before?: number): Promise<{ cleared: number }> {
    return this.client.post("/sandbox/observability/clear", { before });
  }
}
