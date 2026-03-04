import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { getContainerStats, getDocker } from "../docker/client.js";
import type { Sandbox, ResourceAlert, AlertEvent } from "../types.js";

const VALID_METRICS = ["cpu", "memory", "pids"] as const;
const VALID_ACTIONS = ["notify", "pause", "kill"] as const;
const ALERT_EVENTS_SCOPE = "alert_event";

export function registerMonitorFunctions(
  sdk: any,
  kv: StateKV,
  _config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "monitor::set-alert" },
    async (input: {
      id: string;
      metric: string;
      threshold: number;
      action?: string;
    }): Promise<ResourceAlert> => {
      if (!input.id) throw new Error("sandboxId is required");
      if (!input.metric) throw new Error("metric is required");

      const metric = input.metric as ResourceAlert["metric"];
      if (!VALID_METRICS.includes(metric)) {
        throw new Error(`Invalid metric: ${input.metric}. Must be one of: ${VALID_METRICS.join(", ")}`);
      }

      if (input.threshold == null) throw new Error("threshold is required");

      if (metric === "pids") {
        if (input.threshold < 1 || input.threshold > 256) {
          throw new Error("pids threshold must be between 1 and 256");
        }
      } else {
        if (input.threshold < 0 || input.threshold > 100) {
          throw new Error(`${metric} threshold must be between 0 and 100`);
        }
      }

      const action = (input.action ?? "notify") as ResourceAlert["action"];
      if (!VALID_ACTIONS.includes(action)) {
        throw new Error(`Invalid action: ${input.action}. Must be one of: ${VALID_ACTIONS.join(", ")}`);
      }

      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      const alertId = generateId("alrt");
      const alert: ResourceAlert = {
        id: alertId,
        sandboxId: input.id,
        metric,
        threshold: input.threshold,
        action,
        triggered: false,
        createdAt: Date.now(),
      };

      await kv.set(SCOPES.ALERTS, alertId, alert);
      return alert;
    },
  );

  sdk.registerFunction(
    { id: "monitor::list-alerts" },
    async (input: { id: string }): Promise<{ alerts: ResourceAlert[] }> => {
      if (!input.id) throw new Error("sandboxId is required");
      const all = await kv.list<ResourceAlert>(SCOPES.ALERTS);
      const alerts = all.filter((a) => a.sandboxId === input.id);
      return { alerts };
    },
  );

  sdk.registerFunction(
    { id: "monitor::delete-alert" },
    async (input: { alertId: string }): Promise<{ deleted: string }> => {
      if (!input.alertId) throw new Error("alertId is required");
      const alert = await kv.get<ResourceAlert>(SCOPES.ALERTS, input.alertId);
      if (!alert) throw new Error(`Alert not found: ${input.alertId}`);
      await kv.delete(SCOPES.ALERTS, input.alertId);
      return { deleted: input.alertId };
    },
  );

  sdk.registerFunction(
    { id: "monitor::history" },
    async (input: {
      id: string;
      limit?: number;
    }): Promise<{ events: AlertEvent[]; total: number }> => {
      if (!input.id) throw new Error("sandboxId is required");
      let events = await kv.list<AlertEvent>(ALERT_EVENTS_SCOPE);
      events = events.filter((e) => e.sandboxId === input.id);
      events.sort((a, b) => b.timestamp - a.timestamp);
      const total = events.length;
      const limit = input.limit ?? 50;
      return { events: events.slice(0, limit), total };
    },
  );

  sdk.registerFunction(
    { id: "monitor::check" },
    async (): Promise<{ checked: number; triggered: number }> => {
      const alerts = await kv.list<ResourceAlert>(SCOPES.ALERTS);
      let checked = 0;
      let triggered = 0;

      for (const alert of alerts) {
        const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, alert.sandboxId);
        if (!sandbox || sandbox.status !== "running") continue;

        checked++;
        let value: number;

        try {
          const container = getDocker().getContainer(`iii-sbx-${alert.sandboxId}`);
          const stats = await getContainerStats(container);

          if (alert.metric === "cpu") value = stats.cpuPercent;
          else if (alert.metric === "memory") value = (stats.memoryUsageMb / stats.memoryLimitMb) * 100;
          else value = stats.pids;
        } catch {
          continue;
        }

        alert.lastChecked = Date.now();

        if (
          (alert.metric === "pids" && value >= alert.threshold) ||
          (alert.metric !== "pids" && value >= alert.threshold)
        ) {
          triggered++;
          alert.triggered = true;
          alert.lastTriggered = Date.now();

          const event: AlertEvent = {
            alertId: alert.id,
            sandboxId: alert.sandboxId,
            metric: alert.metric,
            value,
            threshold: alert.threshold,
            action: alert.action,
            timestamp: Date.now(),
          };

          await kv.set(ALERT_EVENTS_SCOPE, generateId("aevt"), event);

          if (alert.action === "pause") {
            try {
              await sdk.trigger("sandbox::pause", { id: alert.sandboxId });
            } catch {}
          } else if (alert.action === "kill") {
            try {
              await sdk.trigger("sandbox::kill", { id: alert.sandboxId });
            } catch {}
          }
        }

        await kv.set(SCOPES.ALERTS, alert.id, alert);
      }

      return { checked, triggered };
    },
  );
}
