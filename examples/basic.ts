import { createSandbox } from "@iii-sandbox/sdk"

async function main() {
  console.log("Creating sandbox...")
  const sbx = await createSandbox({ image: "python:3.12-slim" })
  console.log(`Sandbox created: ${sbx.id}`)

  const result = await sbx.exec("python3 --version")
  console.log(`Python version: ${result.stdout.trim()}`)

  const whoami = await sbx.exec("whoami")
  console.log(`Running as: ${whoami.stdout.trim()}`)

  const ls = await sbx.exec("ls -la /workspace")
  console.log(`Workspace:\n${ls.stdout}`)

  await sbx.kill()
  console.log("Sandbox killed")
}

main().catch(console.error)
