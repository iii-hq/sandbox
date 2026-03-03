import { getContext } from "iii-sdk"
import type { StateKV } from "../state/kv.js"
import { SCOPES } from "../state/schema.js"
import { getContainerStats, getDocker } from "../docker/client.js"
import type { Sandbox, SandboxMetrics, GlobalMetrics } from "../types.js"

const startTime = Date.now()
let totalCreated = 0
let totalKilled = 0
let totalExpired = 0

export function incrementCreated() { totalCreated++ }
export function incrementKilled() { totalKilled++ }
export function incrementExpired() { totalExpired++ }

export function registerMetricsFunctions(sdk: any, kv: StateKV) {
  sdk.registerFunction(
    { id: "metrics::sandbox", description: "Get metrics for a sandbox" },
    async (input: { id: string }): Promise<SandboxMetrics> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id)
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`)
      const container = getDocker().getContainer(`iii-sbx-${input.id}`)
      return getContainerStats(container)
    },
  )

  sdk.registerFunction(
    { id: "metrics::global", description: "Get global metrics" },
    async (): Promise<GlobalMetrics> => {
      const sandboxes = await kv.list<Sandbox>(SCOPES.SANDBOXES)
      return {
        activeSandboxes: sandboxes.length,
        totalCreated,
        totalKilled,
        totalExpired,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      }
    },
  )
}
