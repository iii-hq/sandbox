import type { ClientConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpClient {
  private baseUrl: string;
  private token?: string;
  private timeoutMs: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok)
      throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok)
      throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async del<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok)
      throw new Error(
        `DELETE ${path} failed: ${res.status} ${await res.text()}`,
      );
    return res.json() as Promise<T>;
  }

  async *stream(path: string, body?: unknown): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), Accept: "text/event-stream" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`STREAM ${path} failed: ${res.status}`);
    yield* this.readSSE(res);
  }

  private async *readSSE(res: Response): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) yield line.slice(6);
      }
    }
  }
}
