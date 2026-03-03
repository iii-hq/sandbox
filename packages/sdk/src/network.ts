import type { HttpClient } from "./client.js";

export interface SandboxNetwork {
  id: string;
  name: string;
  dockerNetworkId: string;
  sandboxes: string[];
  createdAt: number;
}

export class NetworkManager {
  constructor(private client: HttpClient) {}

  async create(
    name: string,
    driver?: string,
  ): Promise<SandboxNetwork> {
    return this.client.post<SandboxNetwork>("/sandbox/networks", {
      name,
      driver,
    });
  }

  async list(): Promise<{ networks: SandboxNetwork[] }> {
    return this.client.get<{ networks: SandboxNetwork[] }>(
      "/sandbox/networks",
    );
  }

  async connect(
    networkId: string,
    sandboxId: string,
  ): Promise<{ connected: true }> {
    return this.client.post<{ connected: true }>(
      `/sandbox/networks/${networkId}/connect`,
      { sandboxId },
    );
  }

  async disconnect(
    networkId: string,
    sandboxId: string,
  ): Promise<{ disconnected: true }> {
    return this.client.post<{ disconnected: true }>(
      `/sandbox/networks/${networkId}/disconnect`,
      { sandboxId },
    );
  }

  async delete(networkId: string): Promise<{ deleted: string }> {
    return this.client.del<{ deleted: string }>(
      `/sandbox/networks/${networkId}`,
    );
  }
}
