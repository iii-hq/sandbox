import { createSandbox } from "@iii-sandbox/sdk"

async function main() {
  const sbx = await createSandbox({ image: "python:3.12-slim" })
  console.log(`Sandbox: ${sbx.id}`)

  const pythonResult = await sbx.interpreter.run(`
import sys
print(f"Python {sys.version}")
print(f"Sum: {sum(range(100))}")
`, "python")
  console.log("Python output:", pythonResult.output)

  const bashResult = await sbx.interpreter.run(`
echo "Hello from bash"
uname -a
`, "bash")
  console.log("Bash output:", bashResult.output)

  await sbx.kill()
}

main().catch(console.error)
