import type { HttpClient } from "./client.js";

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol: string;
  state: "mapped" | "active";
}

export class PortManager {
  constructor(
    private client: HttpClient,
    private sandboxId: string,
  ) {}

  async expose(
    containerPort: number,
    hostPort?: number,
    protocol?: string,
  ): Promise<PortMapping> {
    return this.client.post<PortMapping>(
      `/sandbox/sandboxes/${this.sandboxId}/ports`,
      { containerPort, hostPort, protocol },
    );
  }

  async list(): Promise<{ ports: PortMapping[] }> {
    return this.client.get<{ ports: PortMapping[] }>(
      `/sandbox/sandboxes/${this.sandboxId}/ports`,
    );
  }

  async unexpose(containerPort: number): Promise<{ removed: number }> {
    return this.client.del<{ removed: number }>(
      `/sandbox/sandboxes/${this.sandboxId}/ports?containerPort=${containerPort}`,
    );
  }
}
