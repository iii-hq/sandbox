import type { EngineConfig } from "../config.js"

export function registerCronTriggers(sdk: any, config: EngineConfig) {
  sdk.registerTrigger({
    type: "cron",
    function_id: "lifecycle::ttl-sweep",
    config: { expression: config.ttlSweepInterval },
  })
}
