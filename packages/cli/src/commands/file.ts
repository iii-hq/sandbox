import { readFileSync } from "node:fs"
import { getSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function fileReadCommand(sandboxId: string, path: string, config: ClientConfig) {
  const sbx = await getSandbox(sandboxId, config)
  const content = await sbx.filesystem.read(path)
  process.stdout.write(content)
}

export async function fileWriteCommand(
  sandboxId: string,
  path: string,
  content: string,
  config: ClientConfig,
) {
  const sbx = await getSandbox(sandboxId, config)
  await sbx.filesystem.write(path, content)
  console.log(`Written: ${path}`)
}

export async function fileUploadCommand(
  sandboxId: string,
  localPath: string,
  remotePath: string,
  config: ClientConfig,
) {
  const sbx = await getSandbox(sandboxId, config)
  const data = readFileSync(localPath)
  await sbx.filesystem.upload(remotePath, data.toString("base64"))
  console.log(`Uploaded: ${localPath} -> ${remotePath}`)
}

export async function fileListCommand(sandboxId: string, path: string, config: ClientConfig) {
  const sbx = await getSandbox(sandboxId, config)
  const files = await sbx.filesystem.list(path)
  for (const f of files) {
    const type = f.isDirectory ? "d" : "-"
    console.log(`${type} ${f.size.toString().padStart(10)} ${f.name}`)
  }
}
