import Docker from "dockerode";
import { PassThrough } from "node:stream";
import type {
  SandboxConfig,
  ExecResult,
  ExecStreamChunk,
  SandboxMetrics,
  FileInfo,
  FileMetadata,
} from "../types.js";

const docker = new Docker();

export function getDocker(): Docker {
  return docker;
}

export async function createContainer(
  id: string,
  config: SandboxConfig,
  entrypoint?: string[],
): Promise<Docker.Container> {
  const containerOpts: any = {
    Image: config.image,
    name: `iii-sbx-${id}`,
    Hostname: id,
    WorkingDir: config.workdir ?? "/workspace",
    Env: Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`),
    Tty: false,
    OpenStdin: false,
    HostConfig: {
      Memory: (config.memory ?? 512) * 1024 * 1024,
      CpuShares: (config.cpu ?? 1) * 1024,
      PidsLimit: 256,
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["NET_RAW", "SYS_ADMIN", "MKNOD"],
      NetworkMode: config.network ? "bridge" : "none",
      ReadonlyRootfs: false,
    },
    Labels: {
      "iii-sandbox": "true",
      "iii-sandbox-id": id,
    },
  };

  if (entrypoint && entrypoint.length > 0) {
    containerOpts.Entrypoint = entrypoint;
  } else {
    containerOpts.Cmd = ["tail", "-f", "/dev/null"];
  }

  const container = await docker.createContainer(containerOpts);
  await container.start();
  return container;
}

export async function execInContainer(
  container: Docker.Container,
  command: string[],
  timeoutMs: number,
): Promise<ExecResult> {
  const start = Date.now();
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err || !stream) {
        clearTimeout(timer);
        return reject(err ?? new Error("No stream"));
      }

      let stdout = "";
      let stderr = "";

      const passStdout = new PassThrough();
      const passStderr = new PassThrough();
      docker.modem.demuxStream(stream, passStdout, passStderr);

      passStdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      passStderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      stream.on("end", async () => {
        clearTimeout(timer);
        const inspect = await exec.inspect();
        resolve({
          exitCode: inspect.ExitCode ?? -1,
          stdout,
          stderr,
          duration: Date.now() - start,
        });
      });
    });
  });
}

export async function execStreamInContainer(
  container: Docker.Container,
  command: string[],
  timeoutMs: number,
  onChunk: (chunk: ExecStreamChunk) => void,
): Promise<void> {
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onChunk({ type: "exit", data: "-1", timestamp: Date.now() });
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err || !stream) {
        clearTimeout(timer);
        return reject(err ?? new Error("No stream"));
      }

      const passStdout = new PassThrough();
      const passStderr = new PassThrough();
      docker.modem.demuxStream(stream, passStdout, passStderr);

      passStdout.on("data", (d: Buffer) => {
        onChunk({ type: "stdout", data: d.toString(), timestamp: Date.now() });
      });

      passStderr.on("data", (d: Buffer) => {
        onChunk({ type: "stderr", data: d.toString(), timestamp: Date.now() });
      });

      stream.on("end", async () => {
        clearTimeout(timer);
        const inspect = await exec.inspect();
        onChunk({
          type: "exit",
          data: String(inspect.ExitCode ?? -1),
          timestamp: Date.now(),
        });
        resolve();
      });
    });
  });
}

export async function getContainerStats(
  container: Docker.Container,
): Promise<SandboxMetrics> {
  const stats = (await container.stats({ stream: false })) as any;
  const info = await container.inspect();
  const id = info.Config?.Labels?.["iii-sandbox-id"] ?? info.Id.slice(0, 12);

  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus ?? 1;

  return {
    sandboxId: id,
    cpuPercent: systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0,
    memoryUsageMb: Math.round(stats.memory_stats.usage / 1024 / 1024),
    memoryLimitMb: Math.round(stats.memory_stats.limit / 1024 / 1024),
    networkRxBytes: stats.networks?.eth0?.rx_bytes ?? 0,
    networkTxBytes: stats.networks?.eth0?.tx_bytes ?? 0,
    pids: stats.pids_stats?.current ?? 0,
  };
}

export async function copyToContainer(
  container: Docker.Container,
  path: string,
  content: Buffer,
): Promise<void> {
  const { pack } = await import("tar-stream");
  const tarStream = pack();
  const name = path.split("/").pop()!;
  const dir = path.substring(0, path.lastIndexOf("/")) || "/";

  tarStream.entry({ name }, content);
  tarStream.finalize();

  await container.putArchive(tarStream, { path: dir });
}

export async function copyFromContainer(
  container: Docker.Container,
  path: string,
): Promise<Buffer> {
  const stream = await container.getArchive({ path });
  const { extract } = await import("tar-stream");
  const ex = extract();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    ex.on("entry", (_header, entryStream, next) => {
      entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      entryStream.on("end", next);
    });
    ex.on("finish", () => resolve(Buffer.concat(chunks)));
    ex.on("error", reject);
    (stream as any).pipe(ex);
  });
}

export async function listContainerDir(
  container: Docker.Container,
  path: string,
): Promise<FileInfo[]> {
  const result = await execInContainer(
    container,
    ["find", path, "-maxdepth", "1", "-printf", "%f\\t%s\\t%T@\\t%y\\n"],
    10000,
  );

  if (result.exitCode !== 0) return [];

  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(1)
    .map((line) => {
      const [name, size, mtime, type] = line.split("\t");
      return {
        name,
        path: `${path}/${name}`.replace("//", "/"),
        size: parseInt(size, 10) || 0,
        isDirectory: type === "d",
        modifiedAt: Math.floor(parseFloat(mtime) * 1000),
      };
    });
}

export async function searchInContainer(
  container: Docker.Container,
  dir: string,
  pattern: string,
): Promise<string[]> {
  const result = await execInContainer(
    container,
    ["find", dir, "-name", pattern, "-type", "f"],
    10000,
  );
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

export async function execBackground(
  container: Docker.Container,
  command: string[],
): Promise<{ id: string; pid: number }> {
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    Detach: true,
  } as Docker.ExecCreateOptions);
  const started = exec as unknown as Docker.Exec;
  await started.start({ Detach: true } as any);
  const inspected = await started.inspect();
  return { id: inspected.ID, pid: inspected.Pid };
}

export async function getFileInfo(
  container: Docker.Container,
  paths: string[],
): Promise<FileMetadata[]> {
  const result = await execInContainer(
    container,
    ["stat", "--format", "%n\\t%s\\t%A\\t%U\\t%G\\t%F\\t%Y", ...paths],
    10000,
  );
  if (result.exitCode !== 0) throw new Error(`stat failed: ${result.stderr}`);
  return result.stdout
    .trim()
    .split("\\n")
    .filter(Boolean)
    .map((line) => {
      const [path, size, permissions, owner, group, type, mtime] =
        line.split("\\t");
      return {
        path,
        size: parseInt(size, 10) || 0,
        permissions,
        owner,
        group,
        isDirectory: type === "directory",
        isSymlink: type === "symbolic link",
        modifiedAt: parseInt(mtime, 10) * 1000,
      };
    });
}
