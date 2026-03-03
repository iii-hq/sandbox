import { getSandbox } from "@iii-sandbox/sdk"
import type { ClientConfig } from "@iii-sandbox/sdk"

export async function logsCommand(sandboxId: string, config: ClientConfig) {
  const sbx = await getSandbox(sandboxId, config)
  const result = await sbx.exec("cat /var/log/*.log 2>/dev/null || echo 'No logs found'")
  console.log(result.stdout)
}
