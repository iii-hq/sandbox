import type { HttpClient } from "./client.js"
import type { FileInfo } from "./types.js"

export class FileSystem {
  constructor(private client: HttpClient, private sandboxId: string) {}

  async read(path: string): Promise<string> {
    return this.client.post<string>(`/sandbox/sandboxes/${this.sandboxId}/files/read`, { path })
  }

  async write(path: string, content: string): Promise<void> {
    await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/write`, { path, content })
  }

  async delete(path: string): Promise<void> {
    await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/delete`, { path })
  }

  async list(path = "/workspace"): Promise<FileInfo[]> {
    return this.client.post<FileInfo[]>(`/sandbox/sandboxes/${this.sandboxId}/files/list`, { path })
  }

  async search(pattern: string, dir = "/workspace"): Promise<string[]> {
    return this.client.post<string[]>(`/sandbox/sandboxes/${this.sandboxId}/files/search`, { pattern, dir })
  }

  async upload(path: string, content: string): Promise<void> {
    await this.client.post(`/sandbox/sandboxes/${this.sandboxId}/files/upload`, { path, content })
  }

  async download(path: string): Promise<string> {
    return this.client.post<string>(`/sandbox/sandboxes/${this.sandboxId}/files/download`, { path })
  }
}
