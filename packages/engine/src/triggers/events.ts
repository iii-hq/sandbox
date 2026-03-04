import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import { SCOPES, generateId } from "../state/schema.js";
import type { SandboxEvent } from "../types.js";

export function registerEventTriggers(sdk: any, kv?: StateKV) {
  const events = [
    { id: "event::sandbox-created", topic: "sandbox.created" },
    { id: "event::sandbox-killed", topic: "sandbox.killed" },
    { id: "event::sandbox-expired", topic: "sandbox.expired" },
    { id: "event::sandbox-paused", topic: "sandbox.paused" },
    { id: "event::sandbox-resumed", topic: "sandbox.resumed" },
    { id: "event::sandbox-snapshot", topic: "sandbox.snapshot" },
    { id: "event::sandbox-exec", topic: "sandbox.exec" },
    { id: "event::sandbox-error", topic: "sandbox.error" },
  ];

  for (const { id, topic } of events) {
    sdk.registerFunction({ id }, async (data: Record<string, unknown>) => {
      getContext().logger.info(`${topic} event`, data);

      if (kv) {
        const eventId = generateId("evt");
        const event: SandboxEvent = {
          id: eventId,
          topic,
          sandboxId: (data.sandboxId as string) ?? (data.id as string) ?? "",
          data,
          timestamp: Date.now(),
        };
        await kv.set(SCOPES.EVENTS, eventId, event);
      }
    });

    sdk.registerTrigger({
      type: "queue",
      function_id: id,
      config: { topic },
    });
  }
}
