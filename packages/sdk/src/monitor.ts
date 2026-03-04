import type { HttpClient } from "./client.js";

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

export class MonitorManager {
  constructor(
    private client: HttpClient,
    private sandboxId: string,
  ) {}

  async setAlert(
    metric: string,
    threshold: number,
    action?: string,
  ): Promise<ResourceAlert> {
    return this.client.post<ResourceAlert>(
      `/sandbox/sandboxes/${this.sandboxId}/alerts`,
      { metric, threshold, action },
    );
  }

  async listAlerts(): Promise<{ alerts: ResourceAlert[] }> {
    return this.client.get<{ alerts: ResourceAlert[] }>(
      `/sandbox/sandboxes/${this.sandboxId}/alerts`,
    );
  }

  async deleteAlert(alertId: string): Promise<{ deleted: string }> {
    return this.client.del<{ deleted: string }>(
      `/sandbox/alerts/${alertId}`,
    );
  }

  async history(
    limit?: number,
  ): Promise<{ events: AlertEvent[]; total: number }> {
    return this.client.get<{ events: AlertEvent[]; total: number }>(
      `/sandbox/sandboxes/${this.sandboxId}/alerts/history${limit ? `?limit=${limit}` : ""}`,
    );
  }
}
