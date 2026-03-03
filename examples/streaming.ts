import { createSandbox } from "@iii-sandbox/sdk"

async function main() {
  const sbx = await createSandbox({ image: "python:3.12-slim" })
  console.log(`Sandbox: ${sbx.id}`)

  console.log("Streaming output:")
  const stream = await sbx.execStream("for i in $(seq 1 5); do echo \"Line $i\"; sleep 0.5; done")
  for await (const chunk of stream) {
    process.stdout.write(`[${chunk.type}] ${chunk.data}`)
  }

  await sbx.kill()
}

main().catch(console.error)
