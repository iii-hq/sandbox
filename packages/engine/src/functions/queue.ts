import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import type { Sandbox, QueueJob, ExecResult } from "../types.js";

export function registerQueueFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "queue::submit", description: "Submit a command to the execution queue" },
    async (input: {
      id: string;
      command: string;
      maxRetries?: number;
      timeout?: number;
    }): Promise<QueueJob> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      if (sandbox.status !== "running")
        throw new Error(`Sandbox is not running: ${sandbox.status}`);

      const jobId = generateId("job");
      const job: QueueJob = {
        id: jobId,
        sandboxId: input.id,
        command: input.command,
        status: "pending",
        retries: 0,
        maxRetries: input.maxRetries ?? 3,
        createdAt: Date.now(),
      };

      await kv.set(SCOPES.QUEUE, jobId, job);
      sdk.trigger("queue::process", { jobId }).catch(() => {});
      return job;
    },
  );

  sdk.registerFunction(
    { id: "queue::status", description: "Get queue job status" },
    async (input: { jobId: string }): Promise<QueueJob> => {
      const job = await kv.get<QueueJob>(SCOPES.QUEUE, input.jobId);
      if (!job) throw new Error(`Queue job not found: ${input.jobId}`);
      return job;
    },
  );

  sdk.registerFunction(
    { id: "queue::cancel", description: "Cancel a pending queue job" },
    async (input: { jobId: string }): Promise<{ cancelled: string }> => {
      const job = await kv.get<QueueJob>(SCOPES.QUEUE, input.jobId);
      if (!job) throw new Error(`Queue job not found: ${input.jobId}`);
      if (job.status !== "pending")
        throw new Error(`Job is not pending: ${job.status}`);

      job.status = "cancelled";
      job.completedAt = Date.now();
      await kv.set(SCOPES.QUEUE, input.jobId, job);
      return { cancelled: input.jobId };
    },
  );

  sdk.registerFunction(
    { id: "queue::dlq", description: "List failed jobs (dead letter queue)" },
    async (input: {
      limit?: number;
      offset?: number;
    }): Promise<{ jobs: QueueJob[]; total: number }> => {
      const all = await kv.list<QueueJob>(SCOPES.QUEUE);
      const failed = all.filter((j) => j.status === "failed");
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;
      return {
        jobs: failed.slice(offset, offset + limit),
        total: failed.length,
      };
    },
  );

  sdk.registerFunction(
    { id: "queue::process", description: "Process a queued job" },
    async (input: { jobId: string }): Promise<QueueJob> => {
      const job = await kv.get<QueueJob>(SCOPES.QUEUE, input.jobId);
      if (!job) throw new Error(`Queue job not found: ${input.jobId}`);
      if (job.status !== "pending") return job;

      job.status = "running";
      job.startedAt = Date.now();
      await kv.set(SCOPES.QUEUE, job.id, job);

      try {
        const result: ExecResult = await sdk.trigger("cmd::run", {
          id: job.sandboxId,
          command: job.command,
        });
        job.status = "completed";
        job.result = result;
        job.completedAt = Date.now();
      } catch (err: any) {
        job.retries++;
        if (job.retries >= job.maxRetries) {
          job.status = "failed";
          job.error = err?.message ?? "Unknown error";
          job.completedAt = Date.now();
        } else {
          job.status = "pending";
          job.startedAt = undefined;
        }
      }

      await kv.set(SCOPES.QUEUE, job.id, job);
      return job;
    },
  );
}
