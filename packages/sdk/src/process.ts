import type { HttpClient } from "./client.js";

export interface ProcessInfo {
  pid: number;
  user: string;
  cpu: string;
  memory: string;
  command: string;
}

export interface ProcessTopInfo {
  pid: number;
  cpu: string;
  mem: string;
  vsz: number;
  rss: number;
  command: string;
}

export class ProcessManager {
  constructor(private client: HttpClient, private sandboxId: string) {}

  async list(): Promise<{ processes: ProcessInfo[] }> {
    return this.client.get(`/sandbox/sandboxes/${this.sandboxId}/processes`);
  }

  async kill(pid: number, signal?: string): Promise<{ killed: number; signal: string }> {
    return this.client.post(`/sandbox/sandboxes/${this.sandboxId}/processes/kill`, { pid, signal });
  }

  async top(): Promise<{ processes: ProcessTopInfo[] }> {
    return this.client.get(`/sandbox/sandboxes/${this.sandboxId}/processes/top`);
  }
}
