import { describe, it, expect, vi, beforeEach } from "vitest"

import { registerCronTriggers } from "../../packages/engine/src/triggers/cron.js"
import type { EngineConfig } from "../../packages/engine/src/config.js"

describe("Cron Triggers", () => {
  let sdk: any

  beforeEach(() => {
    sdk = {
      registerTrigger: vi.fn(),
    }
  })

  it("registers cron trigger with correct expression from config", () => {
    const config = {
      ttlSweepInterval: "*/30 * * * * *",
    } as EngineConfig

    registerCronTriggers(sdk, config)

    expect(sdk.registerTrigger).toHaveBeenCalledTimes(1)
    expect(sdk.registerTrigger).toHaveBeenCalledWith({
      type: "cron",
      function_id: "lifecycle::ttl-sweep",
      config: { expression: "*/30 * * * * *" },
    })
  })

  it("uses custom interval from config", () => {
    const config = {
      ttlSweepInterval: "*/10 * * * * *",
    } as EngineConfig

    registerCronTriggers(sdk, config)

    expect(sdk.registerTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { expression: "*/10 * * * * *" },
      }),
    )
  })

  it("targets lifecycle::ttl-sweep function", () => {
    const config = {
      ttlSweepInterval: "0 * * * *",
    } as EngineConfig

    registerCronTriggers(sdk, config)

    const call = sdk.registerTrigger.mock.calls[0][0]
    expect(call.type).toBe("cron")
    expect(call.function_id).toBe("lifecycle::ttl-sweep")
  })
})
