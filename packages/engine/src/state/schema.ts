import { randomBytes } from "node:crypto";

export const SCOPES = {
  SANDBOXES: "sandbox",
  METRICS: "metrics",
  GLOBAL: "global",
  BACKGROUND: "background",
  TEMPLATES: "template",
  SNAPSHOTS: "snapshot",
  EVENTS: "event",
  QUEUE: "queue",
  OBSERVABILITY: "observability",
  NETWORKS: "network",
  VOLUMES: "volume",
  ALERTS: "alert",
} as const;

export function generateId(prefix = "sbx"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
