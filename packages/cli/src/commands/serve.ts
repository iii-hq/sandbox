export async function serveCommand(opts: { port?: number }) {
  const { spawnSync } = await import("node:child_process");
  const port = opts.port ?? 3111;
  const entrypoint = new URL("../../engine/src/index.ts", import.meta.url)
    .pathname;
  console.log(`Starting iii-sandbox engine on port ${port}...`);
  spawnSync("tsx", [entrypoint], {
    stdio: "inherit",
    env: { ...process.env, III_REST_PORT: String(port) },
  });
}
