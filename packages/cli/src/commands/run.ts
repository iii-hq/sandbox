import { getSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function runCommand(
  sandboxId: string,
  code: string,
  opts: { language?: string },
  config: ClientConfig,
) {
  const sbx = await getSandbox(sandboxId, config)
  const result = await sbx.interpreter.run(code, opts.language ?? "python")
  if (result.output) console.log(result.output)
  if (result.error) console.error(result.error)
}
