import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import type { SandboxEvent } from "../types.js";

export function registerEventFunctions(
  sdk: any,
  kv: StateKV,
  _config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "event::publish", description: "Publish a sandbox event" },
    async (input: {
      topic: string;
      sandboxId: string;
      data?: Record<string, unknown>;
    }): Promise<SandboxEvent> => {
      if (!input.topic) throw new Error("topic is required");
      if (!input.sandboxId) throw new Error("sandboxId is required");

      const id = generateId("evt");
      const event: SandboxEvent = {
        id,
        topic: input.topic,
        sandboxId: input.sandboxId,
        data: input.data ?? {},
        timestamp: Date.now(),
      };

      await kv.set(SCOPES.EVENTS, id, event);
      await sdk.trigger("queue::publish", {
        topic: input.topic,
        payload: event,
      });

      return event;
    },
  );

  sdk.registerFunction(
    { id: "event::history", description: "Query event history" },
    async (input: {
      sandboxId?: string;
      topic?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ events: SandboxEvent[]; total: number }> => {
      let events = await kv.list<SandboxEvent>(SCOPES.EVENTS);

      if (input.sandboxId) {
        events = events.filter((e) => e.sandboxId === input.sandboxId);
      }
      if (input.topic) {
        events = events.filter((e) => e.topic === input.topic);
      }

      events.sort((a, b) => b.timestamp - a.timestamp);

      const total = events.length;
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;
      const sliced = events.slice(offset, offset + limit);

      return { events: sliced, total };
    },
  );

  sdk.registerFunction(
    { id: "event::subscribe", description: "Subscribe to a topic" },
    async (input: { topic: string }): Promise<{ subscribed: string }> => {
      if (!input.topic) throw new Error("topic is required");

      const handlerId = `event::on-${input.topic.replace(/\./g, "-")}`;

      sdk.registerFunction({ id: handlerId }, async (data: Record<string, unknown>) => {
        const id = generateId("evt");
        const event: SandboxEvent = {
          id,
          topic: input.topic,
          sandboxId: (data.sandboxId as string) ?? "",
          data,
          timestamp: Date.now(),
        };
        await kv.set(SCOPES.EVENTS, id, event);
      });

      sdk.registerTrigger({
        type: "queue",
        function_id: handlerId,
        config: { topic: input.topic },
      });

      return { subscribed: input.topic };
    },
  );
}
