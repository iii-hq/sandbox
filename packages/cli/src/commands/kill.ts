import { getSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function killCommand(sandboxId: string, config: ClientConfig) {
  const sbx = await getSandbox(sandboxId, config)
  await sbx.kill()
  console.log(`Killed sandbox: ${sandboxId}`)
}
