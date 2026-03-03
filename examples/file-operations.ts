import { createSandbox } from "@iii-sandbox/sdk"

async function main() {
  const sbx = await createSandbox({ image: "python:3.12-slim" })
  console.log(`Sandbox: ${sbx.id}`)

  await sbx.filesystem.write("/workspace/hello.py", `print("Hello from sandbox!")`)
  console.log("File written")

  const content = await sbx.filesystem.read("/workspace/hello.py")
  console.log("File content:", content)

  const result = await sbx.exec("python3 /workspace/hello.py")
  console.log("Execution:", result.stdout)

  const files = await sbx.filesystem.list("/workspace")
  console.log("Files:", files.map(f => f.name))

  await sbx.kill()
}

main().catch(console.error)
