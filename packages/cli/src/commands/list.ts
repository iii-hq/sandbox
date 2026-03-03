import { listSandboxes } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function listCommand(config: ClientConfig) {
  const sandboxes = await listSandboxes(config)
  if (sandboxes.length === 0) {
    console.log("No active sandboxes")
    return
  }
  console.log(`${"ID".padEnd(32)} ${"IMAGE".padEnd(25)} ${"STATUS".padEnd(10)} EXPIRES`)
  for (const s of sandboxes) {
    const expires = new Date(s.expiresAt).toLocaleTimeString()
    console.log(`${s.id.padEnd(32)} ${s.image.padEnd(25)} ${s.status.padEnd(10)} ${expires}`)
  }
}
