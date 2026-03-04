import type { HttpClient } from "./client.js";

export interface VolumeInfo {
  id: string;
  name: string;
  dockerVolumeName: string;
  mountPath?: string;
  sandboxId?: string;
  size?: string;
  createdAt: number;
}

export class VolumeManager {
  constructor(private client: HttpClient) {}

  async create(name: string, driver?: string): Promise<VolumeInfo> {
    return this.client.post<VolumeInfo>("/sandbox/volumes", { name, driver });
  }

  async list(): Promise<{ volumes: VolumeInfo[] }> {
    return this.client.get<{ volumes: VolumeInfo[] }>("/sandbox/volumes");
  }

  async delete(volumeId: string): Promise<{ deleted: string }> {
    return this.client.del<{ deleted: string }>(`/sandbox/volumes/${volumeId}`);
  }

  async attach(
    volumeId: string,
    sandboxId: string,
    mountPath: string,
  ): Promise<{ attached: boolean; mountPath: string }> {
    return this.client.post<{ attached: boolean; mountPath: string }>(
      `/sandbox/volumes/${volumeId}/attach`,
      { sandboxId, mountPath },
    );
  }

  async detach(volumeId: string): Promise<{ detached: boolean }> {
    return this.client.post<{ detached: boolean }>(
      `/sandbox/volumes/${volumeId}/detach`,
    );
  }
}
