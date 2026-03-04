import { getSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function logsCommand(sandboxId: string, config: ClientConfig) {
  const sbx = await getSandbox(sandboxId, config)
  for await (const event of sbx.streams.logs({ tail: 100, follow: false })) {
    const prefix = event.type === "stderr" ? "[stderr]" : "[stdout]"
    process.stdout.write(`${prefix} ${event.data}\n`)
    if (event.type === "end") break
  }
}
