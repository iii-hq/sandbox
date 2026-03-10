import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Step {
  action: string;
  params?: Record<string, unknown>;
  expect?: Record<string, unknown>;
}

interface Scenario {
  name: string;
  steps: Step[];
}

interface Config {
  baseUrl: string;
  apiPrefix: string;
  authToken: string;
  image: string;
  timeout: number;
}

interface ScenarioFile {
  config: Config;
  scenarios: Scenario[];
}

const BASE_URL = process.env.TEST_BASE_URL || "";
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || "";

function loadScenarios(): ScenarioFile {
  const raw = readFileSync(join(__dirname, "scenario.json"), "utf-8");
  const data = JSON.parse(raw) as ScenarioFile;
  if (BASE_URL) data.config.baseUrl = BASE_URL;
  if (AUTH_TOKEN) data.config.authToken = AUTH_TOKEN;
  return data;
}

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function httpPost(baseUrl: string, path: string, token: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function httpGet(baseUrl: string, path: string, token: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function httpDelete(baseUrl: string, path: string, token: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function assertEq(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function checkExpect(result: Record<string, unknown>, expect: Record<string, unknown>, action: string): void {
  for (const [key, val] of Object.entries(expect)) {
    if (key === "containsFile") {
      const files = result["files"] as Array<{ name: string }> | undefined;
      if (!files || !files.some((f) => f.name === val)) {
        throw new Error(`${action}: expected files to contain "${val}"`);
      }
    } else if (key === "containsKey") {
      const vars = result["vars"] as Record<string, string> | undefined;
      if (!vars || !(val as string in vars)) {
        throw new Error(`${action}: expected vars to contain key "${val}"`);
      }
    } else if (key === "minCount") {
      const count = Array.isArray(result["snapshots"]) ? result["snapshots"].length : 0;
      if (count < (val as number)) {
        throw new Error(`${action}: expected at least ${val} items, got ${count}`);
      }
    } else if (key === "success") {
      continue;
    } else {
      assertEq(`${action}.${key}`, result[key], val);
    }
  }
}

async function runStep(
  step: Step,
  ctx: { baseUrl: string; prefix: string; token: string; sandboxId: string },
): Promise<string> {
  let result: Record<string, unknown> = {};

  switch (step.action) {
    case "create": {
      const data = (await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes`, ctx.token, step.params)) as Record<string, unknown>;
      ctx.sandboxId = data["id"] as string;
      result = data;
      break;
    }
    case "get": {
      result = (await httpGet(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}`, ctx.token)) as Record<string, unknown>;
      break;
    }
    case "exec": {
      const body: Record<string, unknown> = { command: step.params!["command"] };
      if (step.params!["workdir"]) body["cwd"] = step.params!["workdir"];
      result = (await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/exec`, ctx.token, body)) as Record<string, unknown>;
      break;
    }
    case "pause": {
      await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/pause`, ctx.token);
      result = (await httpGet(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}`, ctx.token)) as Record<string, unknown>;
      break;
    }
    case "resume": {
      await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/resume`, ctx.token);
      result = (await httpGet(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}`, ctx.token)) as Record<string, unknown>;
      break;
    }
    case "kill": {
      await httpDelete(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}`, ctx.token);
      result = { success: true };
      break;
    }
    case "fs-write": {
      await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/files/write`, ctx.token, {
        path: step.params!["path"],
        content: step.params!["content"],
      });
      break;
    }
    case "fs-read": {
      const data = await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/files/read`, ctx.token, {
        path: step.params!["path"],
      });
      result = typeof data === "string" ? { content: data } : (data as Record<string, unknown>);
      break;
    }
    case "fs-list": {
      const data = await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/files/list`, ctx.token, {
        path: step.params!["path"],
      });
      result = { files: data };
      break;
    }
    case "fs-delete": {
      await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/files/delete`, ctx.token, {
        path: step.params!["path"],
      });
      break;
    }
    case "env-set": {
      await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/env`, ctx.token, {
        vars: { [step.params!["key"] as string]: step.params!["value"] },
      });
      break;
    }
    case "env-get": {
      result = (await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/env/get`, ctx.token, {
        key: step.params!["key"],
      })) as Record<string, unknown>;
      break;
    }
    case "env-list": {
      result = (await httpGet(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/env`, ctx.token)) as Record<string, unknown>;
      break;
    }
    case "env-delete": {
      await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/env/delete`, ctx.token, {
        key: step.params!["key"],
      });
      break;
    }
    case "snapshot-create": {
      result = (await httpPost(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/snapshots`, ctx.token, {
        name: step.params!["name"],
      })) as Record<string, unknown>;
      break;
    }
    case "snapshot-list": {
      result = (await httpGet(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}/snapshots`, ctx.token)) as Record<string, unknown>;
      break;
    }
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }

  if (step.expect) {
    checkExpect(result, step.expect, step.action);
  }

  return ctx.sandboxId;
}

async function runScenario(scenario: Scenario, config: Config): Promise<{ name: string; pass: boolean; error?: string }> {
  const ctx = {
    baseUrl: config.baseUrl,
    prefix: config.apiPrefix,
    token: config.authToken,
    sandboxId: "",
  };

  try {
    for (const step of scenario.steps) {
      ctx.sandboxId = await runStep(step, ctx);
    }
    return { name: scenario.name, pass: true };
  } catch (err) {
    if (ctx.sandboxId) {
      try {
        await httpDelete(ctx.baseUrl, `${ctx.prefix}/sandboxes/${ctx.sandboxId}`, ctx.token);
      } catch (cleanupErr) {
        console.warn(`[WARN] Cleanup failed for ${ctx.sandboxId}:`, cleanupErr);
      }
    }
    return { name: scenario.name, pass: false, error: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const data = loadScenarios();
  const results: Array<{ name: string; pass: boolean; error?: string }> = [];

  console.log(`Running ${data.scenarios.length} scenarios against ${data.config.baseUrl}\n`);

  for (const scenario of data.scenarios) {
    const result = await runScenario(scenario, data.config);
    results.push(result);
    if (result.pass) {
      console.log(`[PASS] ${result.name}`);
    } else {
      console.log(`[FAIL] ${result.name}: ${result.error}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} scenarios`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
