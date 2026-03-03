import type { StateKV } from "../state/kv.js"
import type { EngineConfig } from "../config.js"
import { SCOPES, generateId } from "../state/schema.js"
import type { TraceRecord, ObservabilityMetrics, Sandbox } from "../types.js"

export function registerObservabilityFunctions(sdk: any, kv: StateKV, config: EngineConfig) {
  sdk.registerFunction(
    { id: "observability::record-trace", description: "Record a function trace" },
    async (input: {
      functionId: string
      sandboxId?: string
      duration: number
      status: "ok" | "error"
      error?: string
    }): Promise<TraceRecord> => {
      const trace: TraceRecord = {
        id: generateId("trc"),
        functionId: input.functionId,
        sandboxId: input.sandboxId,
        duration: input.duration,
        status: input.status,
        error: input.error,
        timestamp: Date.now(),
      }
      await kv.set(SCOPES.OBSERVABILITY, trace.id, trace)
      return trace
    },
  )

  sdk.registerFunction(
    { id: "observability::traces", description: "List traces with optional filters" },
    async (input: {
      sandboxId?: string
      functionId?: string
      limit?: number
      offset?: number
    }): Promise<{ traces: TraceRecord[]; total: number }> => {
      let traces = await kv.list<TraceRecord>(SCOPES.OBSERVABILITY)

      if (input.sandboxId) {
        traces = traces.filter((t) => t.sandboxId === input.sandboxId)
      }
      if (input.functionId) {
        traces = traces.filter((t) => t.functionId === input.functionId)
      }

      traces.sort((a, b) => b.timestamp - a.timestamp)
      const total = traces.length
      const offset = input.offset ?? 0
      const limit = input.limit ?? 100
      traces = traces.slice(offset, offset + limit)

      return { traces, total }
    },
  )

  sdk.registerFunction(
    { id: "observability::metrics", description: "Aggregate observability metrics" },
    async (): Promise<ObservabilityMetrics> => {
      const traces = await kv.list<TraceRecord>(SCOPES.OBSERVABILITY)
      const sandboxes = await kv.list<Sandbox>(SCOPES.SANDBOXES)

      const totalRequests = traces.length
      const totalErrors = traces.filter((t) => t.status === "error").length
      const durations = traces.map((t) => t.duration).sort((a, b) => a - b)
      const avgDuration = totalRequests > 0
        ? durations.reduce((sum, d) => sum + d, 0) / totalRequests
        : 0
      const p95Duration = totalRequests > 0
        ? durations[Math.floor(totalRequests * 0.95)] ?? durations[durations.length - 1]
        : 0

      const functionCounts: Record<string, number> = {}
      for (const t of traces) {
        functionCounts[t.functionId] = (functionCounts[t.functionId] ?? 0) + 1
      }

      return {
        totalRequests,
        totalErrors,
        avgDuration,
        p95Duration,
        activeSandboxes: sandboxes.length,
        functionCounts,
      }
    },
  )

  sdk.registerFunction(
    { id: "observability::clear", description: "Clear traces before a timestamp" },
    async (input: { before?: number }): Promise<{ cleared: number }> => {
      const traces = await kv.list<TraceRecord>(SCOPES.OBSERVABILITY)
      const cutoff = input.before ?? Date.now()
      let cleared = 0

      for (const trace of traces) {
        if (trace.timestamp < cutoff) {
          await kv.delete(SCOPES.OBSERVABILITY, trace.id)
          cleared++
        }
      }

      return { cleared }
    },
  )
}
