import type { HttpClient } from "./client.js"
import type { CodeResult, KernelSpec } from "./types.js"

export class CodeInterpreter {
  constructor(private client: HttpClient, private sandboxId: string) {}

  async run(code: string, language = "python"): Promise<CodeResult> {
    return this.client.post<CodeResult>(
      `/sandbox/sandboxes/${this.sandboxId}/interpret/execute`,
      { code, language },
    )
  }

  async install(packages: string[], manager: "pip" | "npm" | "go" = "pip"): Promise<string> {
    const result = await this.client.post<{ output: string }>(
      `/sandbox/sandboxes/${this.sandboxId}/interpret/install`,
      { packages, manager },
    )
    return result.output
  }

  async kernels(): Promise<KernelSpec[]> {
    return this.client.get<KernelSpec[]>(
      `/sandbox/sandboxes/${this.sandboxId}/interpret/kernels`,
    )
  }
}
