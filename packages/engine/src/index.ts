import { init } from "iii-sdk";
import { loadConfig } from "./config.js";
import { StateKV } from "./state/kv.js";
import { registerSandboxFunctions } from "./functions/sandbox.js";
import { registerCommandFunctions } from "./functions/command.js";
import { registerFilesystemFunctions } from "./functions/filesystem.js";
import { registerInterpreterFunctions } from "./functions/interpreter.js";
import { registerBackgroundFunctions } from "./functions/background.js";
import { registerMetricsFunctions } from "./functions/metrics.js";
import { registerTtlSweep } from "./lifecycle/ttl.js";
import { registerApiTriggers } from "./triggers/api.js";
import { registerCronTriggers } from "./triggers/cron.js";
import { registerEventTriggers } from "./triggers/events.js";
import { cleanupAll } from "./lifecycle/cleanup.js";

async function main() {
  const config = loadConfig();
  console.log(`[iii-sandbox] Starting worker: ${config.workerName}`);
  console.log(`[iii-sandbox] Engine: ${config.engineUrl}`);
  console.log(`[iii-sandbox] API prefix: ${config.apiPrefix}`);

  const sdk = init(config.engineUrl, { workerName: config.workerName });
  const kv = new StateKV(sdk);

  registerSandboxFunctions(sdk, kv, config);
  registerCommandFunctions(sdk, kv, config);
  registerFilesystemFunctions(sdk, kv, config);
  registerInterpreterFunctions(sdk, kv, config);
  registerBackgroundFunctions(sdk, kv, config);
  registerMetricsFunctions(sdk, kv);
  registerTtlSweep(sdk, kv);

  registerApiTriggers(sdk, config);
  registerCronTriggers(sdk, config);
  registerEventTriggers(sdk);

  console.log("[iii-sandbox] All functions and triggers registered");
  console.log(
    `[iii-sandbox] REST API at http://localhost:${config.restPort}${config.apiPrefix}`,
  );

  const shutdown = async () => {
    console.log("[iii-sandbox] Shutting down...");
    await cleanupAll(kv);
    await sdk.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[iii-sandbox] Fatal error:", err);
  process.exit(1);
});
