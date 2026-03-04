import type { HttpClient } from "./client.js";

export class EnvManager {
  constructor(
    private client: HttpClient,
    private sandboxId: string,
  ) {}

  async get(
    key: string,
  ): Promise<{ key: string; value: string | null; exists: boolean }> {
    return this.client.post(
      `/sandbox/sandboxes/${this.sandboxId}/env/get`,
      { key },
    );
  }

  async set(
    vars: Record<string, string>,
  ): Promise<{ set: string[]; count: number }> {
    return this.client.post(
      `/sandbox/sandboxes/${this.sandboxId}/env`,
      { vars },
    );
  }

  async list(): Promise<{ vars: Record<string, string>; count: number }> {
    return this.client.get(`/sandbox/sandboxes/${this.sandboxId}/env`);
  }

  async delete(key: string): Promise<{ deleted: string }> {
    return this.client.post(
      `/sandbox/sandboxes/${this.sandboxId}/env/delete`,
      { key },
    );
  }
}
