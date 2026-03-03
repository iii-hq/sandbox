import { createSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function createCommand(
  image: string,
  opts: { name?: string; timeout?: number; memory?: number; network?: boolean },
  config: ClientConfig,
) {
  const sbx = await createSandbox({
    image,
    ...opts,
    baseUrl: config.baseUrl,
    token: config.token,
  })
  console.log(`Created sandbox: ${sbx.id}`)
  console.log(`  Image: ${sbx.info.image}`)
  console.log(`  Status: ${sbx.info.status}`)
  console.log(`  Expires: ${new Date(sbx.info.expiresAt).toISOString()}`)
  return sbx
}
