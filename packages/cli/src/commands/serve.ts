export async function serveCommand(opts: { port?: number }) {
  const { execSync } = await import("node:child_process")
  const port = opts.port ?? 3111
  console.log(`Starting iii-sandbox engine on port ${port}...`)
  execSync(`III_REST_PORT=${port} tsx ${new URL("../../engine/src/index.ts", import.meta.url).pathname}`, {
    stdio: "inherit",
    env: { ...process.env, III_REST_PORT: String(port) },
  })
}
