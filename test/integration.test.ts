import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.III_SANDBOX_URL ?? "http://localhost:3111";
const TOKEN = process.env.III_SANDBOX_TOKEN ?? "";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
};
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

const isDockerAvailable = async () => {
  try {
    const res = await fetch(`${BASE_URL}/sandbox/health`);
    return res.ok;
  } catch {
    return false;
  }
};

describe.skipIf(!(await isDockerAvailable()))("E2E Integration Tests", () => {
  let sandboxId: string;

  describe("Health Check", () => {
    it("returns healthy status", async () => {
      const { status, data } = await api("GET", "/health");
      expect(status).toBe(200);
      expect(data).toBeDefined();
    });
  });

  describe("Sandbox Lifecycle", () => {
    it("creates a sandbox", async () => {
      const { status, data } = await api("POST", "/sandboxes", {
        image: "python:3.12-slim",
        name: "e2e-test",
        timeout: 300,
      });
      expect(status).toBe(200);
      expect(data.id).toBeTruthy();
      expect(data.status).toBe("running");
      expect(data.image).toBe("python:3.12-slim");
      sandboxId = data.id;
    });

    it("gets sandbox by ID", async () => {
      const { status, data } = await api("GET", `/sandboxes/${sandboxId}`);
      expect(status).toBe(200);
      expect(data.id).toBe(sandboxId);
      expect(data.status).toBe("running");
    });

    it("lists sandboxes", async () => {
      const { status, data } = await api("GET", "/sandboxes");
      expect(status).toBe(200);
      expect(data.items).toBeDefined();
      expect(data.items.length).toBeGreaterThanOrEqual(1);
      expect(data.items.some((s: any) => s.id === sandboxId)).toBe(true);
    });

    it("returns 404 for non-existent sandbox", async () => {
      const { status } = await api("GET", "/sandboxes/sbx_nonexistent");
      expect(status).toBe(404);
    });
  });

  describe("Command Execution", () => {
    it("executes a simple command", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "echo hello world",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.stdout.trim()).toBe("hello world");
      expect(data.duration).toBeGreaterThan(0);
    });

    it("captures stderr", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "echo error >&2",
        },
      );
      expect(status).toBe(200);
      expect(data.stderr.trim()).toBe("error");
    });

    it("returns non-zero exit code for failed commands", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "exit 42",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(42);
    });

    it("executes Python code", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: 'python3 -c "print(2+2)"',
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.stdout.trim()).toBe("4");
    });

    it("executes multi-line commands", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "echo line1 && echo line2 && echo line3",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
      const lines = data.stdout.trim().split("\n");
      expect(lines).toHaveLength(3);
    });

    it("handles commands with pipes", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "echo 'hello world' | wc -w",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.stdout.trim()).toBe("2");
    });
  });

  describe("File Operations", () => {
    it("writes a file", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/write`,
        {
          path: "/workspace/test.txt",
          content: "Hello from E2E test!",
        },
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("reads a file", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/read`,
        {
          path: "/workspace/test.txt",
        },
      );
      expect(status).toBe(200);
      expect(data).toContain("Hello from E2E test!");
    });

    it("lists directory contents", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/list`,
        {
          path: "/workspace",
        },
      );
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.some((f: any) => f.name === "test.txt")).toBe(true);
    });

    it("creates a directory", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/mkdir`,
        {
          paths: ["/workspace/subdir"],
        },
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("writes and reads from subdirectory", async () => {
      await api("POST", `/sandboxes/${sandboxId}/files/write`, {
        path: "/workspace/subdir/nested.txt",
        content: "nested content",
      });

      const { data } = await api("POST", `/sandboxes/${sandboxId}/files/read`, {
        path: "/workspace/subdir/nested.txt",
      });
      expect(data).toContain("nested content");
    });

    it("moves a file", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/move`,
        {
          moves: [
            {
              from: "/workspace/subdir/nested.txt",
              to: "/workspace/subdir/moved.txt",
            },
          ],
        },
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const { data: readData } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/read`,
        {
          path: "/workspace/subdir/moved.txt",
        },
      );
      expect(readData).toContain("nested content");
    });

    it("searches for files", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/search`,
        {
          pattern: "*.txt",
        },
      );
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it("deletes a file", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/delete`,
        {
          path: "/workspace/test.txt",
        },
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("removes a directory", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/rmdir`,
        {
          paths: ["/workspace/subdir"],
        },
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("uploads and downloads binary data", async () => {
      const original = Buffer.from("binary data here").toString("base64");

      await api("POST", `/sandboxes/${sandboxId}/files/upload`, {
        path: "/workspace/data.bin",
        content: original,
      });

      const { data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/download`,
        {
          path: "/workspace/data.bin",
        },
      );
      expect(data).toBe(original);
    });
  });

  describe("Code Interpreter", () => {
    it("executes Python code via interpreter", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/interpret/execute`,
        {
          code: "print('hello from interpreter')",
          language: "python",
        },
      );
      expect(status).toBe(200);
      expect(data.output).toContain("hello from interpreter");
    });

    it("executes Bash code via interpreter", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/interpret/execute`,
        {
          code: "echo bash-output",
          language: "bash",
        },
      );
      expect(status).toBe(200);
      expect(data.output).toContain("bash-output");
    });

    it("captures interpreter errors", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/interpret/execute`,
        {
          code: "import nonexistent_module",
          language: "python",
        },
      );
      expect(status).toBe(200);
      expect(data.error).toBeTruthy();
    });
  });

  describe("Sandbox Pause/Resume", () => {
    it("pauses a sandbox", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/pause`,
      );
      expect(status).toBe(200);
      expect(data.status).toBe("paused");
    });

    it("resumes a paused sandbox", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/resume`,
      );
      expect(status).toBe(200);
      expect(data.status).toBe("running");
    });

    it("can execute commands after resume", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "echo resumed",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.stdout.trim()).toBe("resumed");
    });
  });

  describe("TTL Renewal", () => {
    it("renews sandbox expiration", async () => {
      const newExpiry = Date.now() + 7200000;
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/renew`,
        {
          expiresAt: newExpiry,
        },
      );
      expect(status).toBe(200);
      expect(data.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe("Metrics", () => {
    it("gets sandbox metrics", async () => {
      const { status, data } = await api(
        "GET",
        `/sandboxes/${sandboxId}/metrics`,
      );
      expect(status).toBe(200);
      expect(data.sandboxId).toBeDefined();
      expect(typeof data.cpuPercent).toBe("number");
      expect(typeof data.memoryUsageMb).toBe("number");
      expect(typeof data.pids).toBe("number");
    });

    it("gets global metrics", async () => {
      const { status, data } = await api("GET", "/metrics");
      expect(status).toBe(200);
      expect(typeof data.activeSandboxes).toBe("number");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty command output", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "true",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
    });

    it("handles large output", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "seq 1 1000",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
      const lines = data.stdout.trim().split("\n");
      expect(lines).toHaveLength(1000);
    });

    it("handles special characters in commands", async () => {
      const { status, data } = await api(
        "POST",
        `/sandboxes/${sandboxId}/exec`,
        {
          command: "echo 'hello \"world\" $USER'",
        },
      );
      expect(status).toBe(200);
      expect(data.exitCode).toBe(0);
    });

    it("handles unicode in file content", async () => {
      await api("POST", `/sandboxes/${sandboxId}/files/write`, {
        path: "/workspace/unicode.txt",
        content: "Hello 世界 🌍 привет",
      });

      const { data } = await api("POST", `/sandboxes/${sandboxId}/files/read`, {
        path: "/workspace/unicode.txt",
      });
      expect(data).toContain("世界");
    });

    it("handles concurrent commands", async () => {
      const commands = ["echo a", "echo b", "echo c"];
      const results = await Promise.all(
        commands.map((cmd) =>
          api("POST", `/sandboxes/${sandboxId}/exec`, { command: cmd }),
        ),
      );

      for (const { status, data } of results) {
        expect(status).toBe(200);
        expect(data.exitCode).toBe(0);
      }
    });
  });

  describe("Security", () => {
    it("prevents path traversal in file read", async () => {
      const { status } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/read`,
        {
          path: "/etc/passwd",
        },
      );
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it("prevents path traversal in file write", async () => {
      const { status } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/write`,
        {
          path: "../../etc/cron.d/evil",
          content: "malicious",
        },
      );
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it("prevents path traversal with dot-dot", async () => {
      const { status } = await api(
        "POST",
        `/sandboxes/${sandboxId}/files/read`,
        {
          path: "/workspace/../etc/passwd",
        },
      );
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Cleanup", () => {
    it("kills the sandbox", async () => {
      const { status, data } = await api("DELETE", `/sandboxes/${sandboxId}`);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    }, 15000);

    it("sandbox is no longer accessible", async () => {
      const { status } = await api("GET", `/sandboxes/${sandboxId}`);
      expect(status).toBe(404);
    });
  });
});
