import { getContext } from "iii-sdk";

export function registerEventTriggers(sdk: any) {
  const events = [
    { id: "event::sandbox-created", topic: "sandbox.created" },
    { id: "event::sandbox-killed", topic: "sandbox.killed" },
    { id: "event::sandbox-expired", topic: "sandbox.expired" },
  ];

  for (const { id, topic } of events) {
    sdk.registerFunction({ id }, async (data: Record<string, unknown>) => {
      getContext().logger.info(`${topic} event`, data);
    });

    sdk.registerTrigger({
      type: "queue",
      function_id: id,
      config: { topic },
    });
  }
}
