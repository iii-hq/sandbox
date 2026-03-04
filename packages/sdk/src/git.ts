import type { HttpClient } from "./client.js";
import type { ExecResult } from "./types.js";

export interface GitStatus {
  branch: string;
  clean: boolean;
  files: { path: string; status: string }[];
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBranchResult {
  branches: string[];
  current: string;
}

export class GitManager {
  constructor(
    private client: HttpClient,
    private sandboxId: string,
  ) {}

  async clone(
    url: string,
    options?: { path?: string; branch?: string; depth?: number },
  ): Promise<ExecResult> {
    return this.client.post<ExecResult>(
      `/sandbox/sandboxes/${this.sandboxId}/git/clone`,
      { url, ...options },
    );
  }

  async status(path?: string): Promise<GitStatus> {
    return this.client.get<GitStatus>(
      `/sandbox/sandboxes/${this.sandboxId}/git/status${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    );
  }

  async commit(
    message: string,
    options?: { path?: string; all?: boolean },
  ): Promise<ExecResult> {
    return this.client.post<ExecResult>(
      `/sandbox/sandboxes/${this.sandboxId}/git/commit`,
      { message, ...options },
    );
  }

  async diff(options?: {
    path?: string;
    staged?: boolean;
    file?: string;
  }): Promise<{ diff: string }> {
    const params = new URLSearchParams();
    if (options?.path) params.set("path", options.path);
    if (options?.staged) params.set("staged", "true");
    if (options?.file) params.set("file", options.file);
    const qs = params.toString();
    return this.client.get<{ diff: string }>(
      `/sandbox/sandboxes/${this.sandboxId}/git/diff${qs ? `?${qs}` : ""}`,
    );
  }

  async log(options?: {
    path?: string;
    count?: number;
  }): Promise<{ entries: GitLogEntry[] }> {
    const params = new URLSearchParams();
    if (options?.path) params.set("path", options.path);
    if (options?.count) params.set("count", String(options.count));
    const qs = params.toString();
    return this.client.get<{ entries: GitLogEntry[] }>(
      `/sandbox/sandboxes/${this.sandboxId}/git/log${qs ? `?${qs}` : ""}`,
    );
  }

  async branch(options?: {
    path?: string;
    name?: string;
    delete?: boolean;
  }): Promise<GitBranchResult> {
    return this.client.post<GitBranchResult>(
      `/sandbox/sandboxes/${this.sandboxId}/git/branch`,
      options ?? {},
    );
  }

  async checkout(ref: string, path?: string): Promise<ExecResult> {
    return this.client.post<ExecResult>(
      `/sandbox/sandboxes/${this.sandboxId}/git/checkout`,
      { ref, path },
    );
  }

  async push(options?: {
    path?: string;
    remote?: string;
    branch?: string;
    force?: boolean;
  }): Promise<ExecResult> {
    return this.client.post<ExecResult>(
      `/sandbox/sandboxes/${this.sandboxId}/git/push`,
      options ?? {},
    );
  }

  async pull(options?: {
    path?: string;
    remote?: string;
    branch?: string;
  }): Promise<ExecResult> {
    return this.client.post<ExecResult>(
      `/sandbox/sandboxes/${this.sandboxId}/git/pull`,
      options ?? {},
    );
  }
}
