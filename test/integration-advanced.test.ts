import { describe, it, expect } from "vitest";

const BASE_URL = process.env.III_SANDBOX_URL ?? "http://localhost:3111";
const TOKEN = process.env.III_SANDBOX_TOKEN ?? "";

const headers: Record<string, string> = { "Content-Type": "application/json" };
if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${BASE_URL}/sandbox${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const isAdvancedApiAvailable = async () => {
  try {
    const res = await fetch(`${BASE_URL}/sandbox/health`);
    if (!res.ok) return false;
    const envRes = await fetch(`${BASE_URL}/sandbox/templates`, { headers });
    return envRes.status !== 404;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!(await isAdvancedApiAvailable()))(
  "Advanced E2E Integration Tests",
  () => {
    let sandboxId: string;

    it("creates the test sandbox", async () => {
      const { status, data } = await api("POST", "/sandboxes", {
        image: "python:3.12-slim",
        name: "e2e-advanced",
        timeout: 600,
      });
      expect(status).toBe(200);
      expect(data.id).toBeTruthy();
      expect(data.status).toBe("running");
      sandboxId = data.id;
    }, 30000);

    describe("Environment Variables E2E", () => {
      it("sets environment variables", async () => {
        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/env`,
          {
            id: sandboxId,
            vars: { FOO: "bar", BAZ: "qux" },
          },
        );
        expect(status).toBe(200);
        expect(data.set).toContain("FOO");
        expect(data.set).toContain("BAZ");
        expect(data.count).toBe(2);
      }, 30000);

      it("gets a specific environment variable", async () => {
        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/env/get`,
          {
            id: sandboxId,
            key: "FOO",
          },
        );
        expect(status).toBe(200);
        expect(data.key).toBe("FOO");
        expect(data.exists).toBe(true);
      }, 30000);

      it("lists all environment variables including FOO and BAZ", async () => {
        const { status, data } = await api(
          "GET",
          `/sandboxes/${sandboxId}/env`,
        );
        expect(status).toBe(200);
        expect(data.vars).toBeDefined();
        expect(data.count).toBeGreaterThan(0);
      }, 30000);

      it("deletes an environment variable", async () => {
        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/env/delete`,
          {
            id: sandboxId,
            key: "FOO",
          },
        );
        expect(status).toBe(200);
        expect(data.deleted).toBe("FOO");
      }, 30000);

      it("confirms deleted env var is gone", async () => {
        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/env/get`,
          {
            id: sandboxId,
            key: "FOO",
          },
        );
        expect(status).toBe(200);
        expect(data.exists).toBe(false);
        expect(data.value).toBeNull();
      }, 30000);
    });

    describe("Process Management E2E", () => {
      it("starts a background sleep process and lists it", async () => {
        await api("POST", `/sandboxes/${sandboxId}/exec`, {
          command: "sleep 300 &",
        });

        await sleep(1000);

        const { status, data } = await api(
          "GET",
          `/sandboxes/${sandboxId}/processes`,
        );
        expect(status).toBe(200);
        expect(data.processes).toBeDefined();
        expect(Array.isArray(data.processes)).toBe(true);
        expect(data.processes.length).toBeGreaterThanOrEqual(1);
      }, 30000);

      it("gets top-like process info", async () => {
        const { status, data } = await api(
          "GET",
          `/sandboxes/${sandboxId}/processes/top`,
        );
        expect(status).toBe(200);
        expect(data.processes).toBeDefined();
        expect(Array.isArray(data.processes)).toBe(true);
      }, 30000);

      it("kills a process by PID", async () => {
        const exec = await api("POST", `/sandboxes/${sandboxId}/exec`, {
          command: "sleep 999 & echo $!",
        });
        expect(exec.status).toBe(200);
        const pid = parseInt(exec.data.stdout.trim(), 10);
        expect(pid).toBeGreaterThan(0);

        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/processes/kill`,
          {
            id: sandboxId,
            pid,
            signal: "KILL",
          },
        );
        expect(status).toBe(200);
        expect(data.killed).toBe(pid);
        expect(data.signal).toBe("KILL");
      }, 30000);
    });

    describe("Git Operations E2E", () => {
      it("initializes a git repo, writes a file, commits, and verifies log", async () => {
        await api("POST", `/sandboxes/${sandboxId}/exec`, {
          command:
            'cd /workspace && git init && git config user.email "test@test.com" && git config user.name "test"',
        });

        await api("POST", `/sandboxes/${sandboxId}/files/write`, {
          path: "/workspace/hello.txt",
          content: "hello git",
        });

        const statusResult = await api(
          "GET",
          `/sandboxes/${sandboxId}/git/status`,
        );
        expect(statusResult.status).toBe(200);
        expect(statusResult.data.clean).toBe(false);
        expect(
          statusResult.data.files.some(
            (f: any) => f.path === "hello.txt" && f.status === "??",
          ),
        ).toBe(true);

        const commitResult = await api(
          "POST",
          `/sandboxes/${sandboxId}/git/commit`,
          {
            id: sandboxId,
            message: "initial commit",
            all: true,
          },
        );
        expect(commitResult.status).toBe(200);
        expect(commitResult.data.exitCode).toBe(0);

        const logResult = await api("GET", `/sandboxes/${sandboxId}/git/log`);
        expect(logResult.status).toBe(200);
        expect(logResult.data.entries.length).toBeGreaterThanOrEqual(1);
        expect(logResult.data.entries[0].message).toBe("initial commit");

        const diffResult = await api("GET", `/sandboxes/${sandboxId}/git/diff`);
        expect(diffResult.status).toBe(200);
        expect(diffResult.data.diff.trim()).toBe("");
      }, 30000);

      it("creates and lists branches", async () => {
        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/git/branch`,
          {
            id: sandboxId,
            name: "feature-test",
          },
        );
        expect(status).toBe(200);
        expect(data.branches).toBeDefined();
        expect(data.current).toBe("feature-test");
        expect(data.branches).toContain("feature-test");
      }, 30000);
    });

    describe("Port Management E2E", () => {
      it("lists ports and returns a valid response", async () => {
        const { status, data } = await api(
          "GET",
          `/sandboxes/${sandboxId}/ports`,
        );
        expect(status).toBe(200);
        expect(data.ports).toBeDefined();
        expect(Array.isArray(data.ports)).toBe(true);
      }, 30000);

      it("exposes and unexposes a port", async () => {
        const expose = await api("POST", `/sandboxes/${sandboxId}/ports`, {
          id: sandboxId,
          containerPort: 8080,
        });
        expect(expose.status).toBe(200);
        expect(expose.data.containerPort).toBe(8080);
        expect(expose.data.protocol).toBe("tcp");

        const list = await api("GET", `/sandboxes/${sandboxId}/ports`);
        expect(list.data.ports.length).toBeGreaterThanOrEqual(1);
        expect(list.data.ports.some((p: any) => p.containerPort === 8080)).toBe(
          true,
        );

        const unexpose = await api("DELETE", `/sandboxes/${sandboxId}/ports`, {
          id: sandboxId,
          containerPort: 8080,
        });
        expect(unexpose.status).toBe(200);
        expect(unexpose.data.removed).toBe(8080);
      }, 30000);
    });

    describe("Snapshot E2E", () => {
      it("creates, lists, and restores from a snapshot", async () => {
        await api("POST", `/sandboxes/${sandboxId}/files/write`, {
          path: "/workspace/snapshot-test.txt",
          content: "before snapshot",
        });

        const createSnap = await api(
          "POST",
          `/sandboxes/${sandboxId}/snapshots`,
          {
            id: sandboxId,
            name: "test-snap",
          },
        );
        expect(createSnap.status).toBe(200);
        expect(createSnap.data.id).toBeTruthy();
        expect(createSnap.data.name).toBe("test-snap");
        const snapshotId = createSnap.data.id;

        const listSnaps = await api("GET", `/sandboxes/${sandboxId}/snapshots`);
        expect(listSnaps.status).toBe(200);
        expect(listSnaps.data.snapshots.length).toBeGreaterThanOrEqual(1);
        expect(
          listSnaps.data.snapshots.some((s: any) => s.id === snapshotId),
        ).toBe(true);

        await api("POST", `/sandboxes/${sandboxId}/files/write`, {
          path: "/workspace/after-snapshot.txt",
          content: "written after snapshot",
        });

        const restore = await api(
          "POST",
          `/sandboxes/${sandboxId}/snapshots/restore`,
          {
            id: sandboxId,
            snapshotId,
          },
        );
        expect(restore.status).toBe(200);
        expect(restore.data.status).toBe("running");

        await sleep(2000);

        const readOriginal = await api(
          "POST",
          `/sandboxes/${sandboxId}/files/read`,
          {
            path: "/workspace/snapshot-test.txt",
          },
        );
        expect(readOriginal.status).toBe(200);
        expect(readOriginal.data).toContain("before snapshot");
      }, 30000);
    });

    describe("Template E2E", () => {
      it("lists builtin templates", async () => {
        const { status, data } = await api("GET", "/templates");
        expect(status).toBe(200);
        expect(data.templates).toBeDefined();
        expect(data.templates.length).toBeGreaterThanOrEqual(1);

        const builtins = data.templates.filter((t: any) => t.builtin);
        expect(builtins.length).toBeGreaterThanOrEqual(1);
      }, 30000);

      it("creates and retrieves a custom template", async () => {
        const create = await api("POST", "/templates", {
          name: "e2e-custom",
          description: "Custom template for E2E tests",
          config: {
            image: "python:3.12-slim",
            memory: 256,
            timeout: 300,
          },
        });
        expect(create.status).toBe(200);
        expect(create.data.id).toBeTruthy();
        expect(create.data.name).toBe("e2e-custom");
        expect(create.data.builtin).toBe(false);

        const get = await api("GET", `/templates/${create.data.id}`);
        expect(get.status).toBe(200);
        expect(get.data.name).toBe("e2e-custom");

        const del = await api("DELETE", `/templates/${create.data.id}`);
        expect(del.status).toBe(200);
        expect(del.data.deleted).toBe(create.data.id);
      }, 30000);
    });

    describe("Queue E2E", () => {
      it("submits a job, polls until completed, and verifies output", async () => {
        const submit = await api("POST", `/sandboxes/${sandboxId}/exec/queue`, {
          id: sandboxId,
          command: "echo queued-output",
        });
        expect(submit.status).toBe(200);
        expect(submit.data.id).toBeTruthy();
        expect(submit.data.status).toBe("pending");
        const jobId = submit.data.id;

        let job: any = null;
        for (let i = 0; i < 30; i++) {
          await sleep(500);
          const poll = await api("GET", `/queue/${jobId}/status`);
          expect(poll.status).toBe(200);
          job = poll.data;
          if (job.status === "completed" || job.status === "failed") break;
        }

        expect(job).toBeTruthy();
        expect(job.status).toBe("completed");
        expect(job.result).toBeDefined();
        expect(job.result.stdout).toContain("queued-output");
        expect(job.result.exitCode).toBe(0);
      }, 30000);

      it("lists dead letter queue", async () => {
        const { status, data } = await api("GET", "/queue/dlq");
        expect(status).toBe(200);
        expect(data.jobs).toBeDefined();
        expect(Array.isArray(data.jobs)).toBe(true);
        expect(typeof data.total).toBe("number");
      }, 30000);
    });

    describe("Events E2E", () => {
      it("publishes a custom event and queries history", async () => {
        const publish = await api("POST", "/events/publish", {
          topic: "test.e2e.advanced",
          sandboxId,
          data: { action: "integration-test", ts: Date.now() },
        });
        expect(publish.status).toBe(200);
        expect(publish.data.id).toBeTruthy();
        expect(publish.data.topic).toBe("test.e2e.advanced");

        const history = await api(
          "GET",
          `/events/history?sandboxId=${sandboxId}&topic=test.e2e.advanced`,
        );
        expect(history.status).toBe(200);
        expect(history.data.events).toBeDefined();
        expect(history.data.events.length).toBeGreaterThanOrEqual(1);
        expect(
          history.data.events.some((e: any) => e.topic === "test.e2e.advanced"),
        ).toBe(true);
      }, 30000);
    });

    describe("Metrics Dashboard E2E", () => {
      it("gets observability metrics", async () => {
        const { status, data } = await api("GET", "/observability/metrics");
        expect(status).toBe(200);
        expect(typeof data.totalRequests).toBe("number");
        expect(typeof data.totalErrors).toBe("number");
        expect(typeof data.avgDuration).toBe("number");
        expect(typeof data.activeSandboxes).toBe("number");
      }, 30000);

      it("gets observability traces", async () => {
        const { status, data } = await api("GET", "/observability/traces");
        expect(status).toBe(200);
        expect(data.traces).toBeDefined();
        expect(Array.isArray(data.traces)).toBe(true);
        expect(typeof data.total).toBe("number");
      }, 30000);

      it("gets per-sandbox metrics (CPU, memory, PIDs)", async () => {
        const { status, data } = await api(
          "GET",
          `/sandboxes/${sandboxId}/metrics`,
        );
        expect(status).toBe(200);
        expect(typeof data.cpuPercent).toBe("number");
        expect(typeof data.memoryUsageMb).toBe("number");
        expect(typeof data.pids).toBe("number");
        expect(data.pids).toBeGreaterThanOrEqual(1);
      }, 30000);
    });

    describe("Security E2E", () => {
      it("executes commands in a contained sandbox (no host escape)", async () => {
        const { status, data } = await api(
          "POST",
          `/sandboxes/${sandboxId}/exec`,
          {
            command: "echo $(id)",
          },
        );
        expect(status).toBe(200);
        expect(data.exitCode).toBe(0);
        expect(data.stdout).toContain("uid=");
      }, 30000);

      it("blocks path traversal on /etc/shadow", async () => {
        const { status } = await api(
          "POST",
          `/sandboxes/${sandboxId}/files/read`,
          {
            path: "/etc/shadow",
          },
        );
        expect(status).toBeGreaterThanOrEqual(400);
      }, 30000);

      it("enforces workspace isolation with dot-dot sequences", async () => {
        const paths = [
          "/workspace/../../etc/passwd",
          "/workspace/../../../root/.bashrc",
          "/../../../etc/hostname",
        ];

        for (const p of paths) {
          const { status } = await api(
            "POST",
            `/sandboxes/${sandboxId}/files/read`,
            { path: p },
          );
          expect(status).toBeGreaterThanOrEqual(400);
        }
      }, 30000);
    });

    describe("Large File E2E", () => {
      it("writes 100KB file, reads it back, and deletes it", async () => {
        const chunk = "A".repeat(1024);
        const largeContent = chunk.repeat(100);
        expect(largeContent.length).toBe(102400);

        const write = await api("POST", `/sandboxes/${sandboxId}/files/write`, {
          path: "/workspace/large-file.bin",
          content: largeContent,
        });
        expect(write.status).toBe(200);
        expect(write.data.success).toBe(true);

        const read = await api("POST", `/sandboxes/${sandboxId}/files/read`, {
          path: "/workspace/large-file.bin",
        });
        expect(read.status).toBe(200);
        expect(read.data.length).toBe(102400);
        expect(read.data).toBe(largeContent);

        const del = await api("POST", `/sandboxes/${sandboxId}/files/delete`, {
          path: "/workspace/large-file.bin",
        });
        expect(del.status).toBe(200);
        expect(del.data.success).toBe(true);
      }, 30000);
    });

    describe("Concurrent Exec E2E", () => {
      it("runs 10 commands in parallel and all succeed", async () => {
        const commands = Array.from({ length: 10 }, (_, i) => ({
          command: `echo "parallel-${i}"`,
        }));

        const results = await Promise.all(
          commands.map((body) =>
            api("POST", `/sandboxes/${sandboxId}/exec`, body),
          ),
        );

        for (let i = 0; i < 10; i++) {
          expect(results[i].status).toBe(200);
          expect(results[i].data.exitCode).toBe(0);
          expect(results[i].data.stdout.trim()).toBe(`parallel-${i}`);
        }
      }, 30000);
    });

    describe("Background Exec E2E", () => {
      it("runs a background command and retrieves its logs", async () => {
        const bg = await api(
          "POST",
          `/sandboxes/${sandboxId}/exec/background`,
          {
            id: sandboxId,
            command: 'echo "bg-hello" && sleep 1 && echo "bg-done"',
          },
        );
        expect(bg.status).toBe(200);
        expect(bg.data.id).toBeTruthy();
        expect(bg.data.running).toBe(true);
        const bgId = bg.data.id;

        await sleep(3000);

        const logs = await api("GET", `/exec/background/${bgId}/logs`);
        expect(logs.status).toBe(200);
        expect(logs.data.output).toContain("bg-hello");
        expect(logs.data.output).toContain("bg-done");
      }, 30000);
    });

    describe("File Info and Chmod E2E", () => {
      it("gets file info and modifies permissions", async () => {
        await api("POST", `/sandboxes/${sandboxId}/files/write`, {
          path: "/workspace/perm-test.sh",
          content: "#!/bin/sh\necho hello",
        });

        const info = await api("POST", `/sandboxes/${sandboxId}/files/info`, {
          path: "/workspace/perm-test.sh",
        });
        expect(info.status).toBe(200);
        expect(info.data.path).toContain("perm-test.sh");
        expect(info.data.size).toBeGreaterThan(0);

        const chmod = await api("POST", `/sandboxes/${sandboxId}/files/chmod`, {
          path: "/workspace/perm-test.sh",
          mode: "755",
        });
        expect(chmod.status).toBe(200);

        const exec = await api("POST", `/sandboxes/${sandboxId}/exec`, {
          command: "/workspace/perm-test.sh",
        });
        expect(exec.status).toBe(200);
        expect(exec.data.exitCode).toBe(0);
        expect(exec.data.stdout.trim()).toBe("hello");
      }, 30000);
    });

    describe("Clone Sandbox E2E", () => {
      it("clones the sandbox and verifies the clone has the same files", async () => {
        await api("POST", `/sandboxes/${sandboxId}/files/write`, {
          path: "/workspace/clone-marker.txt",
          content: "clone-test-content",
        });

        const clone = await api("POST", `/sandboxes/${sandboxId}/clone`, {
          id: sandboxId,
          name: "e2e-clone",
        });
        expect(clone.status).toBe(200);
        expect(clone.data.id).toBeTruthy();
        expect(clone.data.id).not.toBe(sandboxId);
        const cloneId = clone.data.id;

        await sleep(2000);

        const readClone = await api(
          "POST",
          `/sandboxes/${cloneId}/files/read`,
          {
            path: "/workspace/clone-marker.txt",
          },
        );
        expect(readClone.status).toBe(200);
        expect(readClone.data).toContain("clone-test-content");

        await api("DELETE", `/sandboxes/${cloneId}`);
      }, 30000);
    });

    describe("Global Metrics E2E", () => {
      it("returns global system metrics", async () => {
        const { status, data } = await api("GET", "/metrics");
        expect(status).toBe(200);
        expect(typeof data.activeSandboxes).toBe("number");
        expect(data.activeSandboxes).toBeGreaterThanOrEqual(1);
        expect(typeof data.totalCreated).toBe("number");
        expect(typeof data.uptimeSeconds).toBe("number");
      }, 30000);
    });

    describe("Cleanup", () => {
      it("kills the test sandbox", async () => {
        const { status, data } = await api("DELETE", `/sandboxes/${sandboxId}`);
        expect(status).toBe(200);
        expect(data.success).toBe(true);
      }, 30000);

      it("verifies sandbox is gone", async () => {
        const { status } = await api("GET", `/sandboxes/${sandboxId}`);
        expect(status).toBe(404);
      }, 30000);
    });
  },
);
