import type { HttpClient } from "./client.js";

export interface TerminalSession {
  sessionId: string;
  sandboxId: string;
  execId: string;
  cols: number;
  rows: number;
  shell: string;
  status: string;
  createdAt: number;
}

export class TerminalManager {
  constructor(
    private client: HttpClient,
    private sandboxId: string,
  ) {}

  async create(opts: {
    cols?: number;
    rows?: number;
    shell?: string;
  } = {}): Promise<TerminalSession> {
    return this.client.post<TerminalSession>(
      `/sandbox/sandboxes/${this.sandboxId}/terminal`,
      { cols: opts.cols ?? 80, rows: opts.rows ?? 24, shell: opts.shell },
    );
  }

  async resize(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<{ cols: number; rows: number }> {
    return this.client.post<{ cols: number; rows: number }>(
      `/sandbox/sandboxes/${this.sandboxId}/terminal/${sessionId}/resize`,
      { cols, rows },
    );
  }

  async close(sessionId: string): Promise<{ closed: string }> {
    return this.client.del<{ closed: string }>(
      `/sandbox/sandboxes/${this.sandboxId}/terminal/${sessionId}`,
    );
  }
}
