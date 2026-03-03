import { getDocker } from "./client.js"

export async function pullImage(imageName: string): Promise<void> {
  const docker = getDocker()
  await new Promise<void>((resolve, reject) => {
    docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err)
      docker.modem.followProgress(stream, (err2: Error | null) => {
        if (err2) return reject(err2)
        resolve()
      })
    })
  })
}

export async function imageExists(imageName: string): Promise<boolean> {
  try {
    await getDocker().getImage(imageName).inspect()
    return true
  } catch {
    return false
  }
}

export async function ensureImage(imageName: string): Promise<void> {
  if (!(await imageExists(imageName))) {
    await pullImage(imageName)
  }
}
