import { getContext } from "iii-sdk"
import type { StateKV } from "../state/kv.js"
import { SCOPES } from "../state/schema.js"
import { getDocker } from "../docker/client.js"
import { incrementExpired } from "../functions/metrics.js"
import type { Sandbox } from "../types.js"

export function registerTtlSweep(sdk: any, kv: StateKV) {
  sdk.registerFunction(
    { id: "lifecycle::ttl-sweep", description: "Kill expired sandboxes" },
    async (): Promise<{ swept: number }> => {
      const ctx = getContext()
      const sandboxes = await kv.list<Sandbox>(SCOPES.SANDBOXES)
      const now = Date.now()
      let swept = 0

      for (const sandbox of sandboxes) {
        if (sandbox.expiresAt <= now) {
          ctx.logger.info("Expiring sandbox", { id: sandbox.id })
          try {
            const container = getDocker().getContainer(`iii-sbx-${sandbox.id}`)
            await container.stop().catch(() => {})
            await container.remove({ force: true })
          } catch {}
          await kv.delete(SCOPES.SANDBOXES, sandbox.id)
          incrementExpired()
          swept++
        }
      }

      if (swept > 0) ctx.logger.info("TTL sweep complete", { swept })
      return { swept }
    },
  )

  sdk.registerFunction(
    { id: "lifecycle::health", description: "Health check" },
    async (): Promise<{ status: string; uptime: number }> => {
      return {
        status: "healthy",
        uptime: Math.floor(process.uptime()),
      }
    },
  )
}
