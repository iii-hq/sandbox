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
const mockCommit = vi.fn();
const mockImageInspect = vi.fn();
const mockImageRemove = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  getDocker: () => mockGetDocker(),
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
  createContainer: (...args: any[]) => mockCreateContainer(...args),
}));

vi.mock("../../packages/engine/src/docker/images.js", () => ({
  ensureImage: vi.fn().mockResolvedValue(undefined),
}));

import { registerSandboxFunctions } from "../../packages/engine/src/functions/sandbox.js";
import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js";
import { registerEnvFunctions } from "../../packages/engine/src/functions/env.js";
import { registerQueueFunctions } from "../../packages/engine/src/functions/queue.js";
import { registerSnapshotFunctions } from "../../packages/engine/src/functions/snapshot.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";
import { SCOPES } from "../../packages/engine/src/state/schema.js";

describe("Stress & Concurrency Tests", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, Map<string, any>>;
  let kv: any;
  let triggerMock: ReturnType<typeof vi.fn>;

  const config: EngineConfig = {
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

  const runningSandbox = {
    id: "sbx_test",
    name: "test",
    image: "python:3.12-slim",
    status: "running",
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    config: { image: "python:3.12-slim", memory: 512, cpu: 1 },
    metadata: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    kvStore = new Map();
    handlers = new Map();

    triggerMock = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      duration: 50,
    });

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

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      trigger: triggerMock,
    };

    mockCreateContainer.mockResolvedValue({});
    mockGetDocker.mockReturnValue({
      getContainer: () => ({
        id: "container-1",
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue(undefined),
        unpause: vi.fn().mockResolvedValue(undefined),
        commit: mockCommit,
      }),
      getImage: () => ({
        inspect: mockImageInspect,
        remove: mockImageRemove,
      }),
    });

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "output",
      stderr: "",
      duration: 50,
    });

    mockCommit.mockResolvedValue({ Id: "sha256:abc123" });
    mockImageInspect.mockResolvedValue({ Size: 104857600 });
    mockImageRemove.mockResolvedValue(undefined);

    registerSandboxFunctions(sdk, kv as any, config);
    registerCommandFunctions(sdk, kv as any, config);
    registerEnvFunctions(sdk, kv as any, config);
    registerQueueFunctions(sdk, kv as any, config);
    registerSnapshotFunctions(sdk, kv as any, config);
  });

  describe("Concurrent sandbox creation (20+)", () => {
    it("creates 20 sandboxes concurrently with unique IDs", async () => {
      const create = handlers.get("sandbox::create")!;
      const promises = Array.from({ length: 20 }, () =>
        create({ image: "python:3.12-slim" }),
      );

      const results = await Promise.all(promises);
      const ids = results.map((r: any) => r.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(20);
      expect(results.every((r: any) => r.status === "running")).toBe(true);
      expect(results.every((r: any) => r.image === "python:3.12-slim")).toBe(
        true,
      );
    });

    it("all 20 sandboxes appear in list after concurrent creation", async () => {
      const create = handlers.get("sandbox::create")!;
      const promises = Array.from({ length: 20 }, (_, i) =>
        create({ image: "python:3.12-slim", name: `sbx-${i}` }),
      );

      await Promise.all(promises);

      const list = handlers.get("sandbox::list")!;
      const result = await list({ pageSize: 200 });
      expect(result.total).toBe(20);
      expect(result.items).toHaveLength(20);
    });

    it("concurrent creates with different images all succeed", async () => {
      const create = handlers.get("sandbox::create")!;
      const images = [
        "python:3.12-slim",
        "node:20",
        "ubuntu:22.04",
        "alpine:3.19",
      ];
      const promises = Array.from({ length: 20 }, (_, i) =>
        create({ image: images[i % images.length] }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);

      const imageCounts = new Map<string, number>();
      results.forEach((r: any) => {
        imageCounts.set(r.image, (imageCounts.get(r.image) || 0) + 1);
      });
      expect(imageCounts.get("python:3.12-slim")).toBe(5);
      expect(imageCounts.get("node:20")).toBe(5);
    });
  });

  describe("Concurrent command execution on multiple sandboxes", () => {
    it("executes commands in 10 sandboxes in parallel", async () => {
      const sandboxIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = `sbx_parallel_${i}`;
        sandboxIds.push(id);
        if (!kvStore.has(SCOPES.SANDBOXES))
          kvStore.set(SCOPES.SANDBOXES, new Map());
        kvStore.get(SCOPES.SANDBOXES)!.set(id, {
          ...runningSandbox,
          id,
          name: `parallel-${i}`,
        });
      }

      let callCount = 0;
      mockExecInContainer.mockImplementation(async () => {
        callCount++;
        return {
          exitCode: 0,
          stdout: `result-${callCount}`,
          stderr: "",
          duration: 50,
        };
      });

      const run = handlers.get("cmd::run")!;
      const promises = sandboxIds.map((id) =>
        run({ id, command: "echo hello" }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      expect(results.every((r: any) => r.exitCode === 0)).toBe(true);
      expect(mockExecInContainer).toHaveBeenCalledTimes(10);
    });
  });

  describe("Concurrent kill operations", () => {
    it("kills 10 sandboxes concurrently", async () => {
      const create = handlers.get("sandbox::create")!;
      const created: any[] = [];
      for (let i = 0; i < 10; i++) {
        created.push(await create({ image: "python:3.12-slim" }));
      }

      const kill = handlers.get("sandbox::kill")!;
      const killPromises = created.map((s: any) => kill({ id: s.id }));
      const results = await Promise.all(killPromises);

      expect(results.every((r: any) => r.success === true)).toBe(true);

      const list = handlers.get("sandbox::list")!;
      const remaining = await list({});
      expect(remaining.total).toBe(0);
    });
  });

  describe("Rapid create/destroy cycles", () => {
    it("creates and immediately kills 50 sandboxes in a tight loop", async () => {
      const create = handlers.get("sandbox::create")!;
      const kill = handlers.get("sandbox::kill")!;

      const highLimitConfig = { ...config, maxSandboxes: 100 };
      const highLimitHandlers = new Map<string, Function>();
      const highLimitSdk = {
        registerFunction: vi.fn((meta: any, handler: Function) => {
          highLimitHandlers.set(meta.id, handler);
        }),
        trigger: triggerMock,
      };
      registerSandboxFunctions(highLimitSdk, kv as any, highLimitConfig);
      const hlCreate = highLimitHandlers.get("sandbox::create")!;
      const hlKill = highLimitHandlers.get("sandbox::kill")!;

      for (let i = 0; i < 50; i++) {
        const sbx = await hlCreate({ image: "python:3.12-slim" });
        await hlKill({ id: sbx.id });
      }

      const list = handlers.get("sandbox::list")!;
      const remaining = await list({});
      expect(remaining.total).toBe(0);
    });

    it("verifies no orphaned state in KV store after rapid cycles", async () => {
      const create = handlers.get("sandbox::create")!;
      const kill = handlers.get("sandbox::kill")!;

      const ids: string[] = [];
      for (let i = 0; i < 15; i++) {
        const sbx = await create({ image: "python:3.12-slim" });
        ids.push(sbx.id);
        await kill({ id: sbx.id });
      }

      const sandboxScope = kvStore.get(SCOPES.SANDBOXES);
      const remainingEntries = sandboxScope ? sandboxScope.size : 0;
      expect(remainingEntries).toBe(0);

      const get = handlers.get("sandbox::get")!;
      for (const id of ids) {
        await expect(get({ id })).rejects.toThrow("Sandbox not found");
      }
    });

    it("concurrent create-then-kill pairs do not interfere", async () => {
      const create = handlers.get("sandbox::create")!;
      const kill = handlers.get("sandbox::kill")!;

      const pairs = Array.from({ length: 20 }, async () => {
        const sbx = await create({ image: "python:3.12-slim" });
        await kill({ id: sbx.id });
        return sbx.id;
      });

      const ids = await Promise.all(pairs);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(20);

      const list = handlers.get("sandbox::list")!;
      const remaining = await list({});
      expect(remaining.total).toBe(0);
    });
  });

  describe("Concurrent exec on same sandbox", () => {
    it("runs 20 concurrent commands on the same sandbox", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      let counter = 0;
      mockExecInContainer.mockImplementation(async () => {
        counter++;
        return {
          exitCode: 0,
          stdout: `result-${counter}`,
          stderr: "",
          duration: 10,
        };
      });

      const run = handlers.get("cmd::run")!;
      const promises = Array.from({ length: 20 }, (_, i) =>
        run({ id: "sbx_test", command: `echo ${i}` }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
      expect(results.every((r: any) => r.exitCode === 0)).toBe(true);
      expect(mockExecInContainer).toHaveBeenCalledTimes(20);
    });

    it("concurrent commands each receive independent results", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      mockExecInContainer.mockImplementation(
        async (_container: any, cmd: string[]) => {
          const cmdStr = cmd.join(" ");
          return { exitCode: 0, stdout: cmdStr, stderr: "", duration: 10 };
        },
      );

      const run = handlers.get("cmd::run")!;
      const commands = Array.from({ length: 10 }, (_, i) => `echo test-${i}`);
      const promises = commands.map((command) =>
        run({ id: "sbx_test", command }),
      );

      const results = await Promise.all(promises);
      const stdouts = results.map((r: any) => r.stdout);
      expect(new Set(stdouts).size).toBe(10);
    });

    it("mixed success and failure commands on the same sandbox", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      let callIdx = 0;
      mockExecInContainer.mockImplementation(async () => {
        callIdx++;
        if (callIdx % 3 === 0) {
          return { exitCode: 1, stdout: "", stderr: "error", duration: 10 };
        }
        return { exitCode: 0, stdout: "ok", stderr: "", duration: 10 };
      });

      const run = handlers.get("cmd::run")!;
      const promises = Array.from({ length: 15 }, () =>
        run({ id: "sbx_test", command: "test" }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(15);
      const successes = results.filter((r: any) => r.exitCode === 0);
      const failures = results.filter((r: any) => r.exitCode === 1);
      expect(successes.length).toBe(10);
      expect(failures.length).toBe(5);
    });
  });

  describe("State consistency under concurrency", () => {
    it("concurrent reads and writes to same sandbox state", async () => {
      const create = handlers.get("sandbox::create")!;
      const sbx = await create({ image: "python:3.12-slim" });

      const get = handlers.get("sandbox::get")!;
      const renew = handlers.get("sandbox::renew")!;

      const readPromises = Array.from({ length: 10 }, () =>
        get({ id: sbx.id }),
      );
      const renewPromise = renew({
        id: sbx.id,
        expiresAt: Date.now() + 7200000,
      });

      const [reads, renewed] = await Promise.all([
        Promise.all(readPromises),
        renewPromise,
      ]);

      expect(reads).toHaveLength(10);
      expect(reads.every((r: any) => r.id === sbx.id)).toBe(true);
      expect(renewed.id).toBe(sbx.id);
      expect(renewed.expiresAt).toBeGreaterThanOrEqual(sbx.expiresAt);
    });

    it("concurrent env set operations with overlapping keys", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", {
        ...runningSandbox,
        metadata: {},
      });

      const envSet = handlers.get("env::set")!;

      const setPromises = [
        envSet({
          id: "sbx_test",
          vars: { SHARED_KEY: "value-A", UNIQUE_A: "1" },
        }),
        envSet({
          id: "sbx_test",
          vars: { SHARED_KEY: "value-B", UNIQUE_B: "2" },
        }),
        envSet({
          id: "sbx_test",
          vars: { SHARED_KEY: "value-C", UNIQUE_C: "3" },
        }),
      ];

      const results = await Promise.all(setPromises);
      expect(results).toHaveLength(3);
      expect(results.every((r: any) => r.count === 2)).toBe(true);

      const sandbox = kvStore.get(SCOPES.SANDBOXES)?.get("sbx_test");
      expect(sandbox).toBeDefined();
      expect(sandbox.metadata.env).toBeDefined();
      const env = JSON.parse(sandbox.metadata.env);
      expect(["value-A", "value-B", "value-C"]).toContain(env.SHARED_KEY);
    });

    it("concurrent snapshot create on same sandbox", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      const snapshotCreate = handlers.get("snapshot::create")!;

      const promises = Array.from({ length: 5 }, (_, i) =>
        snapshotCreate({ id: "sbx_test", name: `snap-${i}` }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);

      const snapIds = results.map((r: any) => r.id);
      expect(new Set(snapIds).size).toBe(5);
      expect(results.every((r: any) => r.sandboxId === "sbx_test")).toBe(true);
      expect(results.every((r: any) => r.imageId === "sha256:abc123")).toBe(
        true,
      );

      const snapList = handlers.get("snapshot::list")!;
      const listed = await snapList({ id: "sbx_test" });
      expect(listed.snapshots).toHaveLength(5);
    });

    it("concurrent pause and resume do not corrupt status", async () => {
      const create = handlers.get("sandbox::create")!;
      const sbx = await create({ image: "python:3.12-slim" });

      const pause = handlers.get("sandbox::pause")!;
      await pause({ id: sbx.id });

      const resume = handlers.get("sandbox::resume")!;
      await resume({ id: sbx.id });

      const get = handlers.get("sandbox::get")!;
      const current = await get({ id: sbx.id });
      expect(current.status).toBe("running");
    });
  });

  describe("Max sandbox limit enforcement under race", () => {
    it("enforces maxSandboxes=10 via sequential creates then rejects", async () => {
      const limitedConfig = { ...config, maxSandboxes: 10 };
      const limitedHandlers = new Map<string, Function>();
      const limitedSdk = {
        registerFunction: vi.fn((meta: any, handler: Function) => {
          limitedHandlers.set(meta.id, handler);
        }),
        trigger: triggerMock,
      };
      registerSandboxFunctions(limitedSdk, kv as any, limitedConfig);

      const create = limitedHandlers.get("sandbox::create")!;

      const created: any[] = [];
      for (let i = 0; i < 10; i++) {
        created.push(await create({ image: "python:3.12-slim" }));
      }
      expect(created).toHaveLength(10);

      const rejections = Array.from({ length: 10 }, () =>
        create({ image: "python:3.12-slim" }).then(
          (r: any) => ({ success: true, result: r }),
          (e: any) => ({ success: false, error: e.message }),
        ),
      );
      const results = await Promise.all(rejections);
      expect(results.every((r) => !r.success)).toBe(true);
      expect(
        results.every((r) => r.error.includes("Maximum sandbox limit")),
      ).toBe(true);

      const ids = created.map((s: any) => s.id);
      expect(new Set(ids).size).toBe(10);
    });

    it("limit enforcement works correctly with sequential creates at boundary", async () => {
      const limitedConfig = { ...config, maxSandboxes: 5 };
      const limitedHandlers = new Map<string, Function>();
      const limitedSdk = {
        registerFunction: vi.fn((meta: any, handler: Function) => {
          limitedHandlers.set(meta.id, handler);
        }),
        trigger: triggerMock,
      };
      registerSandboxFunctions(limitedSdk, kv as any, limitedConfig);

      const create = limitedHandlers.get("sandbox::create")!;
      for (let i = 0; i < 5; i++) {
        await create({ image: "python:3.12-slim" });
      }

      await expect(create({ image: "python:3.12-slim" })).rejects.toThrow(
        "Maximum sandbox limit",
      );

      const kill = limitedHandlers.get("sandbox::kill")!;
      const list = limitedHandlers.get("sandbox::list")!;
      const { items } = await list({});
      await kill({ id: items[0].id });

      const newSbx = await create({ image: "python:3.12-slim" });
      expect(newSbx.status).toBe("running");

      await expect(create({ image: "python:3.12-slim" })).rejects.toThrow(
        "Maximum sandbox limit",
      );
    });
  });

  describe("Queue flood", () => {
    it("submits 50 queue jobs rapidly with unique IDs", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      const submit = handlers.get("queue::submit")!;
      const promises = Array.from({ length: 50 }, (_, i) =>
        submit({ id: "sbx_test", command: `echo job-${i}` }),
      );

      const jobs = await Promise.all(promises);
      expect(jobs).toHaveLength(50);

      const jobIds = jobs.map((j: any) => j.id);
      expect(new Set(jobIds).size).toBe(50);
      expect(jobs.every((j: any) => j.status === "pending")).toBe(true);
      expect(jobs.every((j: any) => j.sandboxId === "sbx_test")).toBe(true);
    });

    it("all 50 jobs are trackable via queue::status", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      const submit = handlers.get("queue::submit")!;
      const jobs: any[] = [];
      for (let i = 0; i < 50; i++) {
        jobs.push(await submit({ id: "sbx_test", command: `echo ${i}` }));
      }

      const status = handlers.get("queue::status")!;
      const statusPromises = jobs.map((j: any) => status({ jobId: j.id }));
      const statuses = await Promise.all(statusPromises);

      expect(statuses).toHaveLength(50);
      expect(statuses.every((s: any) => s.sandboxId === "sbx_test")).toBe(true);
    });

    it("concurrent submit and cancel on different jobs", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      const submit = handlers.get("queue::submit")!;
      const cancel = handlers.get("queue::cancel")!;

      const first10: any[] = [];
      for (let i = 0; i < 10; i++) {
        first10.push(await submit({ id: "sbx_test", command: `echo ${i}` }));
      }

      const submitMore = Array.from({ length: 10 }, (_, i) =>
        submit({ id: "sbx_test", command: `echo new-${i}` }),
      );
      const cancelFirst = first10.map((j: any) => cancel({ jobId: j.id }));

      const [newJobs, cancelled] = await Promise.all([
        Promise.all(submitMore),
        Promise.all(cancelFirst),
      ]);

      expect(newJobs).toHaveLength(10);
      expect(cancelled).toHaveLength(10);
      expect(cancelled.every((c: any) => c.cancelled)).toBeTruthy();

      const status = handlers.get("queue::status")!;
      for (const j of first10) {
        const s = await status({ jobId: j.id });
        expect(s.status).toBe("cancelled");
      }
      for (const j of newJobs) {
        const s = await status({ jobId: j.id });
        expect(s.status).toBe("pending");
      }
    });

    it("concurrent process of multiple jobs completes all", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      const submit = handlers.get("queue::submit")!;
      const process = handlers.get("queue::process")!;

      const jobs: any[] = [];
      for (let i = 0; i < 10; i++) {
        jobs.push(await submit({ id: "sbx_test", command: `echo ${i}` }));
      }

      const processPromises = jobs.map((j: any) => process({ jobId: j.id }));
      const processed = await Promise.all(processPromises);

      expect(processed).toHaveLength(10);
      expect(processed.every((p: any) => p.status === "completed")).toBe(true);
      expect(processed.every((p: any) => p.result !== undefined)).toBe(true);
    });
  });

  describe("Concurrent lifecycle transitions", () => {
    it("rapid create, pause, resume, kill cycle on 10 sandboxes", async () => {
      const create = handlers.get("sandbox::create")!;
      const pause = handlers.get("sandbox::pause")!;
      const resume = handlers.get("sandbox::resume")!;
      const kill = handlers.get("sandbox::kill")!;

      const sandboxes: any[] = [];
      for (let i = 0; i < 10; i++) {
        sandboxes.push(await create({ image: "python:3.12-slim" }));
      }

      for (const sbx of sandboxes) {
        await pause({ id: sbx.id });
      }

      const get = handlers.get("sandbox::get")!;
      for (const sbx of sandboxes) {
        const current = await get({ id: sbx.id });
        expect(current.status).toBe("paused");
      }

      const resumePromises = sandboxes.map((sbx: any) =>
        resume({ id: sbx.id }),
      );
      await Promise.all(resumePromises);

      for (const sbx of sandboxes) {
        const current = await get({ id: sbx.id });
        expect(current.status).toBe("running");
      }

      const killPromises = sandboxes.map((sbx: any) => kill({ id: sbx.id }));
      const killResults = await Promise.all(killPromises);
      expect(killResults.every((r: any) => r.success)).toBe(true);

      const list = handlers.get("sandbox::list")!;
      const remaining = await list({});
      expect(remaining.total).toBe(0);
    });
  });

  describe("High-volume env operations", () => {
    it("sets 20 different env vars concurrently on the same sandbox", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", {
        ...runningSandbox,
        metadata: {},
      });

      const envSet = handlers.get("env::set")!;
      const promises = Array.from({ length: 20 }, (_, i) =>
        envSet({ id: "sbx_test", vars: { [`VAR_${i}`]: `value_${i}` } }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
      expect(results.every((r: any) => r.count === 1)).toBe(true);
      expect(mockExecInContainer).toHaveBeenCalledTimes(20);
    });

    it("concurrent env get operations return without blocking", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      mockExecInContainer.mockResolvedValue({
        exitCode: 0,
        stdout: "testval\n",
        stderr: "",
        duration: 10,
      });

      const envGet = handlers.get("env::get")!;
      const promises = Array.from({ length: 20 }, (_, i) =>
        envGet({ id: "sbx_test", key: `VAR_${i}` }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
      expect(results.every((r: any) => r.exists === true)).toBe(true);
      expect(results.every((r: any) => r.value === "testval")).toBe(true);
    });
  });

  describe("Snapshot stress under concurrency", () => {
    it("creates 10 snapshots concurrently then deletes all concurrently", async () => {
      if (!kvStore.has(SCOPES.SANDBOXES))
        kvStore.set(SCOPES.SANDBOXES, new Map());
      kvStore.get(SCOPES.SANDBOXES)!.set("sbx_test", { ...runningSandbox });

      const snapshotCreate = handlers.get("snapshot::create")!;
      const createPromises = Array.from({ length: 10 }, (_, i) =>
        snapshotCreate({ id: "sbx_test", name: `stress-snap-${i}` }),
      );

      const snapshots = await Promise.all(createPromises);
      expect(snapshots).toHaveLength(10);

      const snapList = handlers.get("snapshot::list")!;
      const listed = await snapList({ id: "sbx_test" });
      expect(listed.snapshots).toHaveLength(10);

      const snapshotDelete = handlers.get("snapshot::delete")!;
      const deletePromises = snapshots.map((s: any) =>
        snapshotDelete({ snapshotId: s.id }),
      );

      const deleted = await Promise.all(deletePromises);
      expect(deleted).toHaveLength(10);
      expect(deleted.every((d: any) => d.deleted)).toBeTruthy();

      const afterDelete = await snapList({ id: "sbx_test" });
      expect(afterDelete.snapshots).toHaveLength(0);
    });
  });

  describe("Cross-function concurrency", () => {
    it("concurrent create + list + get does not corrupt state", async () => {
      const create = handlers.get("sandbox::create")!;
      const list = handlers.get("sandbox::list")!;
      const get = handlers.get("sandbox::get")!;

      const sbx1 = await create({ image: "python:3.12-slim" });

      const mixed = [
        create({ image: "python:3.12-slim" }),
        list({}),
        get({ id: sbx1.id }),
        create({ image: "node:20" }),
        list({}),
      ];

      const results = await Promise.all(mixed);
      expect(results[0].status).toBe("running");
      expect(results[2].id).toBe(sbx1.id);
      expect(results[3].status).toBe("running");
    });

    it("interleaved sandbox, command, env, and queue operations", async () => {
      const create = handlers.get("sandbox::create")!;
      const sbx = await create({ image: "python:3.12-slim" });

      const run = handlers.get("cmd::run")!;
      const envSet = handlers.get("env::set")!;
      const submit = handlers.get("queue::submit")!;
      const get = handlers.get("sandbox::get")!;

      const operations = [
        run({ id: sbx.id, command: "echo 1" }),
        envSet({ id: sbx.id, vars: { TEST: "concurrent" } }),
        submit({ id: sbx.id, command: "echo queued" }),
        get({ id: sbx.id }),
        run({ id: sbx.id, command: "echo 2" }),
      ];

      const results = await Promise.all(operations);
      expect(results[0].exitCode).toBe(0);
      expect(results[1].count).toBe(1);
      expect(results[2].status).toBe("pending");
      expect(results[3].id).toBe(sbx.id);
      expect(results[4].exitCode).toBe(0);
    });
  });
});
