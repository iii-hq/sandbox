import { init } from "iii-sdk";
import { loadConfig } from "./config.js";
import { StateKV } from "./state/kv.js";
import { registerSandboxFunctions } from "./functions/sandbox.js";
import { registerCommandFunctions } from "./functions/command.js";
import { registerFilesystemFunctions } from "./functions/filesystem.js";
import { registerInterpreterFunctions } from "./functions/interpreter.js";
import { registerBackgroundFunctions } from "./functions/background.js";
import { registerEnvFunctions } from "./functions/env.js";
import { registerGitFunctions } from "./functions/git.js";
import { registerProcessFunctions } from "./functions/process.js";
import { registerTemplateFunctions } from "./functions/template.js";
import { registerSnapshotFunctions } from "./functions/snapshot.js";
import { registerCloneFunctions } from "./functions/clone.js";
import { registerPortFunctions } from "./functions/port.js";
import { registerMetricsFunctions } from "./functions/metrics.js";
import { registerEventFunctions } from "./functions/event.js";
import { registerQueueFunctions } from "./functions/queue.js";
import { registerNetworkFunctions } from "./functions/network.js";
import { registerObservabilityFunctions } from "./functions/observability.js";
import { registerStreamFunctions } from "./functions/stream.js";
import { registerMonitorFunctions } from "./functions/monitor.js";
import { registerVolumeFunctions } from "./functions/volume.js";
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
  registerEnvFunctions(sdk, kv, config);
  registerGitFunctions(sdk, kv, config);
  registerProcessFunctions(sdk, kv, config);
  registerTemplateFunctions(sdk, kv, config);
  registerSnapshotFunctions(sdk, kv, config);
  registerCloneFunctions(sdk, kv, config);
  registerPortFunctions(sdk, kv, config);
  registerMetricsFunctions(sdk, kv);
  registerEventFunctions(sdk, kv, config);
  registerQueueFunctions(sdk, kv, config);
  registerNetworkFunctions(sdk, kv, config);
  registerObservabilityFunctions(sdk, kv, config);
  registerStreamFunctions(sdk, kv, config);
  registerMonitorFunctions(sdk, kv, config);
  registerVolumeFunctions(sdk, kv, config);
  registerTtlSweep(sdk, kv);

  registerApiTriggers(sdk, config);
  registerCronTriggers(sdk, config);
  registerEventTriggers(sdk, kv);

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
