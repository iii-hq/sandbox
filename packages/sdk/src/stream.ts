import type { ExecStreamChunk } from "./types.js"

export async function* parseExecStream(
  lines: AsyncGenerator<string>,
): AsyncGenerator<ExecStreamChunk> {
  for await (const line of lines) {
    try {
      const chunk = JSON.parse(line) as ExecStreamChunk
      yield chunk
      if (chunk.type === "exit") return
    } catch {
      yield { type: "stdout", data: line, timestamp: Date.now() }
    }
  }
}
