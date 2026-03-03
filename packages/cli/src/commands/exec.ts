import { getSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function execCommand(
  sandboxId: string,
  command: string,
  opts: { timeout?: number; stream?: boolean },
  config: ClientConfig,
) {
  const sbx = await getSandbox(sandboxId, config)

  if (opts.stream) {
    const stream = await sbx.execStream(command)
    for await (const chunk of stream) {
      if (chunk.type === "stdout") process.stdout.write(chunk.data)
      if (chunk.type === "stderr") process.stderr.write(chunk.data)
    }
    return
  }

  const result = await sbx.exec(command, opts.timeout)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.exitCode !== 0) process.exit(result.exitCode)
}
