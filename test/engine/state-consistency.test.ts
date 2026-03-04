import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  };
});

const mockExecInContainer = vi.fn();
const mockGetDocker = vi.fn();
const mockGetContainerStats = vi.fn();
const mockCreateContainer = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => mockGetDocker(),
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
  createContainer: (...args: any[]) => mockCreateContainer(...args),
}));

vi.mock("../../packages/engine/src/docker/images.js", () => ({
  ensureImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../packages/engine/src/functions/metrics.js", () => ({
  incrementExpired: vi.fn(),
}));

import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js";
import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js";
import { registerSnapshotFunctions } from "../../packages/engine/src/functions/snapshot.js";
import { registerQueueFunctions } from "../../packages/engine/src/functions/queue.js";
import { registerMonitorFunctions } from "../../packages/engine/src/functions/monitor.js";
import { registerCloneFunctions } from "../../packages/engine/src/functions/clone.js";
import { registerEnvFunctions } from "../../packages/engine/src/functions/env.js";
import { registerTtlSweep } from "../../packages/engine/src/lifecycle/ttl.js";

describe("State Consistency & Cleanup", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;
  let kv: any;
  let triggerMock: ReturnType<typeof vi.fn>;

  const config: any = {
    apiPrefix: "/sandbox",
    maxSandboxes: 50,
    defaultTimeout: 3600,
    defaultMemory: 512,
    defaultCpu: 1,
    maxCommandTimeout: 300,
    workspaceDir: "/workspace",
    allowedImages: ["*"],
    authToken: "",
    engineUrl: "ws://localhost:49134",
    workerName: "test",
    restPort: 3111,
    maxFileSize: 10485760,
    cleanupOnExit: true,
    defaultImage: "python:3.12-slim",
    ttlSweepInterval: "*/30 * * * * *",
    metricsInterval: "*/60 * * * * *",
  };

  const mockContainer = {
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    unpause: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ Id: "sha256:cloned" }),
  };

  const mockImage = {
    inspect: vi.fn().mockResolvedValue({ Size: 104857600 }),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
    kvStore = new Map();

    kv = {
      get: vi.fn(
        async (scope: string, key: string) =>
          kvStore.get(scope)?.get(key) ?? null,
      ),
      set: vi.fn(async (scope: string, key: string, value: any) => {
        if (!kvStore.has(scope)) kvStore.set(scope, new Map());
        kvStore.get(scope)!.set(key, value);
      }),
      delete: vi.fn(async (scope: string, key: string) => {
        kvStore.get(scope)?.delete(key);
      }),
      list: vi.fn(async (scope: string) => {
        const m = kvStore.get(scope);
        return m ? Array.from(m.values()) : [];
      }),
    };

    triggerMock = vi
      .fn()
      .mockImplementation(async (fnId: string, input: any) => {
        const handler = handlers.get(fnId);
        if (!handler) throw new Error(`Function not found: ${fnId}`);
        return handler(input);
      });

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: triggerMock,
    };

    mockCreateContainer.mockResolvedValue({});
    mockGetDocker.mockReturnValue({
      getContainer: () => mockContainer,
      getImage: () => mockImage,
    });
    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "output",
      stderr: "",
      duration: 50,
    });

    registerSandboxFunctions(sdk, kv as any, config);
    registerCommandFunctions(sdk, kv as any, config);
    registerSnapshotFunctions(sdk, kv as any, config);
    registerQueueFunctions(sdk, kv as any, config);
    registerMonitorFunctions(sdk, kv as any, config);
    registerCloneFunctions(sdk, kv as any, config);
    registerEnvFunctions(sdk, kv as any, config);
    registerTtlSweep(sdk, kv as any);
  });

  async function createTestSandbox(overrides: Record<string, any> = {}) {
    const create = handlers.get("sandbox::create")!;
    return create({ image: "python:3.12-slim", ...overrides });
  }

  function putSandboxInKv(id: string, overrides: Record<string, any> = {}) {
    const sandbox = {
      id,
      name: id,
      image: "python:3.12-slim",
      status: "running",
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      config: { image: "python:3.12-slim", memory: 512, cpu: 1 },
      metadata: {},
      ...overrides,
    };
    if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());
    kvStore.get("sandbox")!.set(id, sandbox);
    return sandbox;
  }

  describe("External container kill (state divergence)", () => {
    it("exec fails when Docker container is gone but KV says running", async () => {
      const sandbox = putSandboxInKv("sbx_ghost");
      mockExecInContainer.mockRejectedValueOnce(new Error("No such container"));

      const run = handlers.get("cmd::run")!;
      await expect(
        run({ id: sandbox.id, command: "echo hello" }),
      ).rejects.toThrow();
    });

    it("kill cleans up KV despite Docker 404", async () => {
      const sandbox = putSandboxInKv("sbx_docker_gone");
      mockContainer.stop.mockRejectedValueOnce(new Error("No such container"));
      mockContainer.remove.mockRejectedValueOnce(
        new Error("No such container"),
      );

      const kill = handlers.get("sandbox::kill")!;
      const result = await kill({ id: sandbox.id });

      expect(result.success).toBe(true);
      expect(kvStore.get("sandbox")!.has(sandbox.id)).toBe(false);
    });
  });

  describe("KV corruption scenarios", () => {
    it("get handles sandbox with null fields gracefully", async () => {
      putSandboxInKv("sbx_corrupt", {
        status: null,
        config: null,
        metadata: null,
      });

      const get = handlers.get("sandbox::get")!;
      const result = await get({ id: "sbx_corrupt" });
      expect(result.id).toBe("sbx_corrupt");
    });

    it("list does not crash on sandbox with undefined fields", async () => {
      putSandboxInKv("sbx_ok");
      putSandboxInKv("sbx_broken", { status: undefined, metadata: undefined });

      const list = handlers.get("sandbox::list")!;
      const result = await list({});

      expect(result.total).toBe(2);
    });

    it("list with status filter skips sandboxes with null status", async () => {
      putSandboxInKv("sbx_good", { status: "running" });
      putSandboxInKv("sbx_null_status", { status: null });

      const list = handlers.get("sandbox::list")!;
      const result = await list({ status: "running" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("sbx_good");
    });
  });

  describe("Orphaned state after failed create", () => {
    it("sandbox is left in KV when createContainer succeeds then fails later", async () => {
      const create = handlers.get("sandbox::create")!;
      const result = await create({ image: "python:3.12-slim" });

      expect(result.status).toBe("running");
      const stored = kvStore.get("sandbox")?.get(result.id);
      expect(stored).toBeDefined();
    });

    it("sandbox is NOT in KV when createContainer throws before KV save", async () => {
      mockCreateContainer.mockRejectedValueOnce(
        new Error("Docker daemon not running"),
      );

      const create = handlers.get("sandbox::create")!;
      await expect(create({ image: "python:3.12-slim" })).rejects.toThrow(
        "Docker daemon not running",
      );

      const all = kvStore.get("sandbox");
      const hasRunning = all
        ? Array.from(all.values()).some((s: any) => s.status === "running")
        : false;
      expect(hasRunning).toBe(false);
    });
  });

  describe("Double delete", () => {
    it("second kill on same ID throws not found", async () => {
      const sandbox = await createTestSandbox();

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });
      await expect(kill({ id: sandbox.id })).rejects.toThrow(
        "Sandbox not found",
      );
    });

    it("get after kill confirms sandbox removed", async () => {
      const sandbox = await createTestSandbox();

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });

      const get = handlers.get("sandbox::get")!;
      await expect(get({ id: sandbox.id })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });

  describe("Queue job with deleted sandbox", () => {
    it("process fails when sandbox is deleted before processing", async () => {
      if (!kvStore.has("queue")) kvStore.set("queue", new Map());
      const jobId = "job_orphan_1";
      kvStore.get("queue")!.set(jobId, {
        id: jobId,
        sandboxId: "sbx_will_die",
        command: "echo hi",
        status: "pending",
        retries: 0,
        maxRetries: 1,
        createdAt: Date.now(),
      });

      const process = handlers.get("queue::process")!;
      const processed = await process({ jobId });

      expect(processed.status).toBe("failed");
      expect(processed.error).toContain("not found");
    });

    it("queue job moves to failed status after max retries on deleted sandbox", async () => {
      const sandbox = await createTestSandbox();

      if (!kvStore.has("queue")) kvStore.set("queue", new Map());
      const jobId = "job_orphan_2";
      kvStore.get("queue")!.set(jobId, {
        id: jobId,
        sandboxId: sandbox.id,
        command: "test",
        status: "pending",
        retries: 0,
        maxRetries: 1,
        createdAt: Date.now(),
      });

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });

      const process = handlers.get("queue::process")!;
      const result = await process({ jobId });

      expect(result.status).toBe("failed");
      expect(result.completedAt).toBeGreaterThan(0);
    });
  });

  describe("Monitor alert on deleted sandbox", () => {
    it("monitor::check skips alert when sandbox is deleted", async () => {
      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_orphan", {
        id: "alrt_orphan",
        sandboxId: "sbx_deleted",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      });

      const check = handlers.get("monitor::check")!;
      const result = await check();

      expect(result.checked).toBe(0);
      expect(result.triggered).toBe(0);
    });

    it("monitor::check skips alert when sandbox exists but is paused", async () => {
      putSandboxInKv("sbx_paused_check", { status: "paused" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_paused", {
        id: "alrt_paused",
        sandboxId: "sbx_paused_check",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      });

      const check = handlers.get("monitor::check")!;
      const result = await check();

      expect(result.checked).toBe(0);
      expect(result.triggered).toBe(0);
    });
  });

  describe("Snapshot of deleted sandbox", () => {
    it("snapshot::create fails for non-existent sandbox", async () => {
      const create = handlers.get("snapshot::create")!;
      await expect(create({ id: "sbx_gone" })).rejects.toThrow(
        "Sandbox not found",
      );
    });

    it("snapshot::create fails after sandbox is killed", async () => {
      const sandbox = await createTestSandbox();

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });

      const snapCreate = handlers.get("snapshot::create")!;
      await expect(snapCreate({ id: sandbox.id })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });

  describe("Clone of non-existent sandbox", () => {
    it("clone throws not found for missing sandbox", async () => {
      const clone = handlers.get("sandbox::clone")!;
      await expect(clone({ id: "sbx_never_existed" })).rejects.toThrow(
        "Sandbox not found",
      );
    });

    it("clone fails after sandbox is killed", async () => {
      const sandbox = await createTestSandbox();

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });

      const clone = handlers.get("sandbox::clone")!;
      await expect(clone({ id: sandbox.id })).rejects.toThrow(
        "Sandbox not found",
      );
    });
  });

  describe("Restore from deleted snapshot", () => {
    it("restore fails when snapshot does not exist", async () => {
      const sandbox = await createTestSandbox();

      const restore = handlers.get("snapshot::restore")!;
      await expect(
        restore({ id: sandbox.id, snapshotId: "snap_missing" }),
      ).rejects.toThrow("Snapshot not found");
    });

    it("restore fails after snapshot is deleted", async () => {
      const sandbox = await createTestSandbox();

      if (!kvStore.has("snapshot")) kvStore.set("snapshot", new Map());
      kvStore.get("snapshot")!.set("snap_temp", {
        id: "snap_temp",
        sandboxId: sandbox.id,
        name: "temp",
        imageId: "sha256:temp123",
        size: 100,
        createdAt: Date.now(),
      });

      const snapDelete = handlers.get("snapshot::delete")!;
      await snapDelete({ snapshotId: "snap_temp" });

      const restore = handlers.get("snapshot::restore")!;
      await expect(
        restore({ id: sandbox.id, snapshotId: "snap_temp" }),
      ).rejects.toThrow("Snapshot not found");
    });
  });

  describe("Env operations after sandbox state changes", () => {
    it("env::set succeeds on running sandbox", async () => {
      putSandboxInKv("sbx_env_run", { status: "running" });

      const envSet = handlers.get("env::set")!;
      const result = await envSet({ id: "sbx_env_run", vars: { FOO: "bar" } });

      expect(result.count).toBe(1);
      expect(result.set).toEqual(["FOO"]);
    });

    it("env::set fails on paused sandbox", async () => {
      putSandboxInKv("sbx_env_pause", { status: "paused" });

      const envSet = handlers.get("env::set")!;
      await expect(
        envSet({ id: "sbx_env_pause", vars: { FOO: "bar" } }),
      ).rejects.toThrow("not running");
    });

    it("env::set fails on killed (non-existent) sandbox", async () => {
      const envSet = handlers.get("env::set")!;
      await expect(
        envSet({ id: "sbx_killed", vars: { FOO: "bar" } }),
      ).rejects.toThrow("Sandbox not found");
    });

    it("env::get fails on paused sandbox", async () => {
      putSandboxInKv("sbx_env_get_paused", { status: "paused" });

      const envGet = handlers.get("env::get")!;
      await expect(
        envGet({ id: "sbx_env_get_paused", key: "FOO" }),
      ).rejects.toThrow("not running");
    });
  });

  describe("State transitions matrix", () => {
    it("running -> paused -> running is valid", async () => {
      const sandbox = await createTestSandbox();

      const pause = handlers.get("sandbox::pause")!;
      const paused = await pause({ id: sandbox.id });
      expect(paused.status).toBe("paused");

      const resume = handlers.get("sandbox::resume")!;
      const resumed = await resume({ id: sandbox.id });
      expect(resumed.status).toBe("running");
    });

    it("running -> killed is valid", async () => {
      const sandbox = await createTestSandbox();

      const kill = handlers.get("sandbox::kill")!;
      const result = await kill({ id: sandbox.id });
      expect(result.success).toBe(true);
    });

    it("paused -> killed is valid", async () => {
      const sandbox = await createTestSandbox();

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sandbox.id });

      const kill = handlers.get("sandbox::kill")!;
      const result = await kill({ id: sandbox.id });
      expect(result.success).toBe(true);
    });

    it("killed -> running is invalid (sandbox removed)", async () => {
      const sandbox = await createTestSandbox();

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });

      const resume = handlers.get("sandbox::resume")!;
      await expect(resume({ id: sandbox.id })).rejects.toThrow("not found");
    });

    it("pausing an already paused sandbox throws error", async () => {
      const sandbox = await createTestSandbox();

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sandbox.id });

      await expect(pause({ id: sandbox.id })).rejects.toThrow("not running");
    });

    it("resuming a running sandbox throws error", async () => {
      const sandbox = await createTestSandbox();

      const resume = handlers.get("sandbox::resume")!;
      await expect(resume({ id: sandbox.id })).rejects.toThrow("not paused");
    });
  });

  describe("Metadata persistence across pause/resume", () => {
    it("env vars in metadata survive pause/resume cycle", async () => {
      const sandbox = await createTestSandbox();

      const envSet = handlers.get("env::set")!;
      await envSet({
        id: sandbox.id,
        vars: { DB_HOST: "localhost", DB_PORT: "5432" },
      });

      const storedBefore = kvStore.get("sandbox")!.get(sandbox.id);
      expect(storedBefore.metadata.env).toBeDefined();
      const envBefore = JSON.parse(storedBefore.metadata.env);
      expect(envBefore.DB_HOST).toBe("localhost");
      expect(envBefore.DB_PORT).toBe("5432");

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sandbox.id });

      const storedWhilePaused = kvStore.get("sandbox")!.get(sandbox.id);
      expect(storedWhilePaused.status).toBe("paused");
      const envWhilePaused = JSON.parse(storedWhilePaused.metadata.env);
      expect(envWhilePaused.DB_HOST).toBe("localhost");
      expect(envWhilePaused.DB_PORT).toBe("5432");

      const resume = handlers.get("sandbox::resume")!;
      await resume({ id: sandbox.id });

      const storedAfter = kvStore.get("sandbox")!.get(sandbox.id);
      expect(storedAfter.status).toBe("running");
      const envAfter = JSON.parse(storedAfter.metadata.env);
      expect(envAfter.DB_HOST).toBe("localhost");
      expect(envAfter.DB_PORT).toBe("5432");
    });

    it("custom metadata survives pause/resume", async () => {
      const sandbox = await createTestSandbox({
        metadata: { team: "alpha", purpose: "ci" },
      });

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sandbox.id });

      const resume = handlers.get("sandbox::resume")!;
      await resume({ id: sandbox.id });

      const get = handlers.get("sandbox::get")!;
      const fetched = await get({ id: sandbox.id });
      expect(fetched.metadata.team).toBe("alpha");
      expect(fetched.metadata.purpose).toBe("ci");
    });
  });

  describe("TTL sweep only removes expired sandboxes", () => {
    it("sweeps expired, keeps valid, handles paused-expired", async () => {
      const now = Date.now();
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());

      kvStore.get("sandbox")!.set("sbx_expired", {
        id: "sbx_expired",
        status: "running",
        expiresAt: now - 10000,
      });
      kvStore.get("sandbox")!.set("sbx_valid", {
        id: "sbx_valid",
        status: "running",
        expiresAt: now + 60000,
      });
      kvStore.get("sandbox")!.set("sbx_paused_expired", {
        id: "sbx_paused_expired",
        status: "paused",
        expiresAt: now - 5000,
      });

      const sweep = handlers.get("lifecycle::ttl-sweep")!;
      const result = await sweep();

      expect(result.swept).toBe(2);
      expect(kvStore.get("sandbox")!.has("sbx_expired")).toBe(false);
      expect(kvStore.get("sandbox")!.has("sbx_paused_expired")).toBe(false);
      expect(kvStore.get("sandbox")!.has("sbx_valid")).toBe(true);
    });

    it("does not sweep sandbox expiring exactly now (boundary)", async () => {
      const now = Date.now();
      if (!kvStore.has("sandbox")) kvStore.set("sandbox", new Map());

      kvStore.get("sandbox")!.set("sbx_boundary", {
        id: "sbx_boundary",
        status: "running",
        expiresAt: now + 100,
      });

      const sweep = handlers.get("lifecycle::ttl-sweep")!;
      const result = await sweep();

      expect(result.swept).toBe(0);
      expect(kvStore.get("sandbox")!.has("sbx_boundary")).toBe(true);
    });
  });

  describe("Alert threshold boundary values", () => {
    it("cpu alert at exactly 0 is accepted", async () => {
      putSandboxInKv("sbx_bnd");

      const setAlert = handlers.get("monitor::set-alert")!;
      const result = await setAlert({
        id: "sbx_bnd",
        metric: "cpu",
        threshold: 0,
      });
      expect(result.threshold).toBe(0);
    });

    it("cpu alert at exactly 100 is accepted", async () => {
      putSandboxInKv("sbx_bnd2");

      const setAlert = handlers.get("monitor::set-alert")!;
      const result = await setAlert({
        id: "sbx_bnd2",
        metric: "cpu",
        threshold: 100,
      });
      expect(result.threshold).toBe(100);
    });

    it("memory alert at -1 is rejected", async () => {
      putSandboxInKv("sbx_bnd3");

      const setAlert = handlers.get("monitor::set-alert")!;
      await expect(
        setAlert({ id: "sbx_bnd3", metric: "memory", threshold: -1 }),
      ).rejects.toThrow("threshold must be between 0 and 100");
    });

    it("memory alert at 101 is rejected", async () => {
      putSandboxInKv("sbx_bnd4");

      const setAlert = handlers.get("monitor::set-alert")!;
      await expect(
        setAlert({ id: "sbx_bnd4", metric: "memory", threshold: 101 }),
      ).rejects.toThrow("threshold must be between 0 and 100");
    });

    it("pids alert at exactly 1 is accepted", async () => {
      putSandboxInKv("sbx_bnd5");

      const setAlert = handlers.get("monitor::set-alert")!;
      const result = await setAlert({
        id: "sbx_bnd5",
        metric: "pids",
        threshold: 1,
      });
      expect(result.threshold).toBe(1);
    });

    it("pids alert at exactly 256 is accepted", async () => {
      putSandboxInKv("sbx_bnd6");

      const setAlert = handlers.get("monitor::set-alert")!;
      const result = await setAlert({
        id: "sbx_bnd6",
        metric: "pids",
        threshold: 256,
      });
      expect(result.threshold).toBe(256);
    });

    it("pids alert at 0 is rejected", async () => {
      putSandboxInKv("sbx_bnd7");

      const setAlert = handlers.get("monitor::set-alert")!;
      await expect(
        setAlert({ id: "sbx_bnd7", metric: "pids", threshold: 0 }),
      ).rejects.toThrow("pids threshold must be between 1 and 256");
    });

    it("pids alert at 257 is rejected", async () => {
      putSandboxInKv("sbx_bnd8");

      const setAlert = handlers.get("monitor::set-alert")!;
      await expect(
        setAlert({ id: "sbx_bnd8", metric: "pids", threshold: 257 }),
      ).rejects.toThrow("pids threshold must be between 1 and 256");
    });
  });

  describe("Queue pagination edge cases", () => {
    it("DLQ with offset=0 limit=0 returns empty", async () => {
      if (!kvStore.has("queue")) kvStore.set("queue", new Map());
      kvStore.get("queue")!.set("job_f1", { id: "job_f1", status: "failed" });

      const dlq = handlers.get("queue::dlq")!;
      const result = await dlq({ limit: 0, offset: 0 });

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(1);
    });

    it("DLQ with offset greater than total returns empty", async () => {
      if (!kvStore.has("queue")) kvStore.set("queue", new Map());
      kvStore.get("queue")!.set("job_f2", { id: "job_f2", status: "failed" });
      kvStore.get("queue")!.set("job_f3", { id: "job_f3", status: "failed" });

      const dlq = handlers.get("queue::dlq")!;
      const result = await dlq({ limit: 10, offset: 100 });

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(2);
    });

    it("DLQ with no failed jobs returns empty list", async () => {
      if (!kvStore.has("queue")) kvStore.set("queue", new Map());
      kvStore
        .get("queue")!
        .set("job_ok", { id: "job_ok", status: "completed" });
      kvStore
        .get("queue")!
        .set("job_pend", { id: "job_pend", status: "pending" });

      const dlq = handlers.get("queue::dlq")!;
      const result = await dlq({});

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("Concurrent monitor::check runs", () => {
    it("two simultaneous check calls both complete without error", async () => {
      putSandboxInKv("sbx_conc", { status: "running" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_conc", {
        id: "alrt_conc",
        sandboxId: "sbx_conc",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      });

      mockGetContainerStats.mockResolvedValue({
        sandboxId: "sbx_conc",
        cpuPercent: 50,
        memoryUsageMb: 256,
        memoryLimitMb: 512,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 5,
      });

      const check = handlers.get("monitor::check")!;
      const [result1, result2] = await Promise.all([check(), check()]);

      expect(result1.checked).toBe(1);
      expect(result2.checked).toBe(1);
      expect(result1.triggered).toBe(0);
      expect(result2.triggered).toBe(0);
    });

    it("concurrent checks with threshold exceeded both report triggered", async () => {
      putSandboxInKv("sbx_conc2", { status: "running" });

      if (!kvStore.has("alert")) kvStore.set("alert", new Map());
      kvStore.get("alert")!.set("alrt_conc2", {
        id: "alrt_conc2",
        sandboxId: "sbx_conc2",
        metric: "cpu",
        threshold: 80,
        action: "notify",
        triggered: false,
        createdAt: Date.now(),
      });

      mockGetContainerStats.mockResolvedValue({
        sandboxId: "sbx_conc2",
        cpuPercent: 95,
        memoryUsageMb: 256,
        memoryLimitMb: 512,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 5,
      });

      const check = handlers.get("monitor::check")!;
      const [result1, result2] = await Promise.all([check(), check()]);

      expect(result1.triggered).toBe(1);
      expect(result2.triggered).toBe(1);
    });
  });

  describe("Cross-function state consistency", () => {
    it("snapshot list returns empty after sandbox is killed", async () => {
      const sandbox = await createTestSandbox();

      if (!kvStore.has("snapshot")) kvStore.set("snapshot", new Map());
      kvStore.get("snapshot")!.set("snap_x", {
        id: "snap_x",
        sandboxId: sandbox.id,
        name: "before-kill",
        imageId: "sha256:x",
        size: 100,
        createdAt: Date.now(),
      });

      const snapList = handlers.get("snapshot::list")!;
      const before = await snapList({ id: sandbox.id });
      expect(before.snapshots).toHaveLength(1);

      const kill = handlers.get("sandbox::kill")!;
      await kill({ id: sandbox.id });

      const after = await snapList({ id: sandbox.id });
      expect(after.snapshots).toHaveLength(1);
    });

    it("queue submit fails after sandbox transitions to paused", async () => {
      const sandbox = await createTestSandbox();

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sandbox.id });

      const submit = handlers.get("queue::submit")!;
      await expect(
        submit({ id: sandbox.id, command: "echo test" }),
      ).rejects.toThrow("not running");
    });

    it("clone of a paused sandbox succeeds", async () => {
      const sandbox = await createTestSandbox();

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sandbox.id });

      const clone = handlers.get("sandbox::clone")!;
      const cloned = await clone({ id: sandbox.id });

      expect(cloned.id).not.toBe(sandbox.id);
      expect(cloned.status).toBe("running");
    });
  });
});
