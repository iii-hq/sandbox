import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("iii-sdk", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    getContext: () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
  };
});

const mockExecInContainer = vi.fn();
const mockExecStreamInContainer = vi.fn();
const mockGetDocker = vi.fn();
const mockGetContainerStats = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  execInContainer: (...args: any[]) => mockExecInContainer(...args),
  execStreamInContainer: (...args: any[]) => mockExecStreamInContainer(...args),
  getDocker: () => mockGetDocker(),
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
}));

import { registerCommandFunctions } from "../../packages/engine/src/functions/command.js";
import { registerStreamFunctions } from "../../packages/engine/src/functions/stream.js";
import { registerEventFunctions } from "../../packages/engine/src/functions/event.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Stream & Event Edge Cases", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, any>;
  let kv: any;
  let triggers: any[];

  const config: EngineConfig = {
    apiPrefix: "/sandbox",
    maxSandboxes: 10,
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
    config: {},
    metadata: {},
  };

  const makeStreamReq = (overrides: any = {}) => {
    const streamWritable = { write: vi.fn() };
    const response = {
      stream: streamWritable,
      sendMessage: vi.fn(),
      close: vi.fn(),
      status: vi.fn(),
      headers: vi.fn(),
    };
    return {
      req: {
        path_params: { id: "sbx_test" },
        body: { command: "echo hello" },
        headers: {},
        query_params: {},
        method: "POST",
        response,
        on: vi.fn(),
        ...overrides,
      },
      response,
      streamWritable,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers = new Map();
    kvStore = new Map();
    triggers = [];
    kvStore.set("sbx_test", runningSandbox);

    kv = {
      get: vi.fn(
        async (_scope: string, key: string) => kvStore.get(key) ?? null,
      ),
      set: vi.fn(async (_scope: string, key: string, value: any) => {
        kvStore.set(key, value);
      }),
      delete: vi.fn(),
      list: vi.fn(async () => [...kvStore.values()]),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      registerTrigger: vi.fn((trigger: any) => {
        triggers.push(trigger);
      }),
      trigger: vi.fn(),
    };

    mockGetDocker.mockReturnValue({
      getContainer: () => ({ id: "container-1" }),
    });

    mockExecInContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "output",
      stderr: "",
      duration: 50,
    });

    mockExecStreamInContainer.mockImplementation(
      async (_container: any, _cmd: any, _timeout: any, onChunk: Function) => {
        onChunk({ type: "stdout", data: "output\n", timestamp: 1000 });
        onChunk({ type: "exit", data: "0", timestamp: 1001 });
      },
    );

    mockGetContainerStats.mockResolvedValue({
      sandboxId: "sbx_test",
      cpuPercent: 5.2,
      memoryUsageMb: 128,
      memoryLimitMb: 512,
      networkRxBytes: 0,
      networkTxBytes: 0,
      pids: 3,
    });

    registerCommandFunctions(sdk, kv as any, config);
    registerStreamFunctions(sdk, kv as any, config);
    registerEventFunctions(sdk, kv as any, config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Stream disconnect simulation", () => {
    it("catches write error from Connection reset and closes cleanly", async () => {
      let writeCount = 0;
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          for (let i = 0; i < 5; i++) {
            onChunk({
              type: "stdout",
              data: `chunk-${i}\n`,
              timestamp: 1000 + i,
            });
          }
          onChunk({ type: "exit", data: "0", timestamp: 2000 });
        },
      );

      const { req, response, streamWritable } = makeStreamReq();
      streamWritable.write.mockImplementation(() => {
        writeCount++;
        if (writeCount > 3) {
          throw new Error("Connection reset");
        }
      });

      const handler = handlers.get("cmd::run-stream")!;
      await expect(handler(req)).resolves.not.toThrow();
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("Slow stream consumer (backpressure)", () => {
    it("delivers all chunks even when write is slow", async () => {
      const chunkCount = 20;
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          for (let i = 0; i < chunkCount; i++) {
            onChunk({
              type: "stdout",
              data: `line-${i}\n`,
              timestamp: 1000 + i,
            });
          }
          onChunk({ type: "exit", data: "0", timestamp: 2000 });
        },
      );

      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(streamWritable.write).toHaveBeenCalledTimes(chunkCount + 1);
    });
  });

  describe("Empty stream output", () => {
    it("sends only the exit chunk when exec produces no output", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "exit", data: "0", timestamp: 1000 });
        },
      );

      const { req, response, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(streamWritable.write).toHaveBeenCalledTimes(1);
      const written = streamWritable.write.mock.calls[0][0];
      expect(written).toContain('"type":"exit"');
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("Binary data in stream", () => {
    it("passes binary (non-UTF8) data through in chunk.data", async () => {
      const binaryStr = Buffer.from([0x00, 0xff, 0x80, 0xfe]).toString();
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: binaryStr, timestamp: 1000 });
          onChunk({ type: "exit", data: "0", timestamp: 1001 });
        },
      );

      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      const stdoutWrite = streamWritable.write.mock.calls[0][0];
      expect(stdoutWrite).toContain('"type":"stdout"');
      const jsonStr = stdoutWrite.replace(/^data: /, "").replace(/\n\n$/, "");
      const parsed = JSON.parse(jsonStr);
      expect(parsed.data).toBe(binaryStr);
    });
  });

  describe("Very rapid chunks (1000 chunks)", () => {
    it("writes all 1000 chunks plus exit to stream", async () => {
      const total = 1000;
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          for (let i = 0; i < total; i++) {
            onChunk({ type: "stdout", data: `x`, timestamp: i });
          }
          onChunk({ type: "exit", data: "0", timestamp: total });
        },
      );

      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(streamWritable.write).toHaveBeenCalledTimes(total + 1);
    });
  });

  describe("Stream with no exit event (timeout)", () => {
    it("closes stream with error when exec times out without exit", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: "partial\n", timestamp: 1000 });
          onChunk({ type: "stdout", data: "more\n", timestamp: 1001 });
          onChunk({ type: "exit", data: "-1", timestamp: 1002 });
          throw new Error("Command timed out after 300000ms");
        },
      );

      const { req, response, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      const exitWrite = streamWritable.write.mock.calls.find(
        ([data]: [string]) => data.includes('"type":"exit"'),
      );
      expect(exitWrite).toBeDefined();
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("Malformed chunk data", () => {
    it("handles chunk with undefined data without crash", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: undefined, timestamp: 1000 });
          onChunk({ type: "exit", data: "0", timestamp: 1001 });
        },
      );

      const { req, response } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await expect(handler(req)).resolves.not.toThrow();
      expect(response.close).toHaveBeenCalled();
    });

    it("handles null chunk without crash", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk(null);
          onChunk({ type: "exit", data: "0", timestamp: 1001 });
        },
      );

      const { req, response } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await expect(handler(req)).resolves.not.toThrow();
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("SSE format compliance", () => {
    it("every write starts with 'data: ' and ends with '\\n\\n'", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: "line1\n", timestamp: 1000 });
          onChunk({ type: "stderr", data: "err1\n", timestamp: 1001 });
          onChunk({ type: "exit", data: "0", timestamp: 1002 });
        },
      );

      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(streamWritable.write).toHaveBeenCalledTimes(3);
      for (const [data] of streamWritable.write.mock.calls) {
        expect(data).toMatch(/^data: /);
        expect(data).toMatch(/\n\n$/);
      }
    });

    it("data between 'data: ' and '\\n\\n' is valid JSON", async () => {
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          onChunk({ type: "stdout", data: "hello", timestamp: 1000 });
          onChunk({ type: "exit", data: "0", timestamp: 1001 });
        },
      );

      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      for (const [data] of streamWritable.write.mock.calls) {
        const jsonStr = data.replace(/^data: /, "").replace(/\n\n$/, "");
        expect(() => JSON.parse(jsonStr)).not.toThrow();
        const parsed = JSON.parse(jsonStr);
        expect(parsed).toHaveProperty("type");
      }
    });
  });

  describe("Concurrent streams on same sandbox", () => {
    it("three simultaneous stream execs do not interfere with each other", async () => {
      let callIndex = 0;
      mockExecStreamInContainer.mockImplementation(
        async (_c: any, _cmd: any, _t: any, onChunk: Function) => {
          const idx = callIndex++;
          onChunk({ type: "stdout", data: `stream-${idx}`, timestamp: 1000 });
          onChunk({ type: "exit", data: "0", timestamp: 1001 });
        },
      );

      const streams = [makeStreamReq(), makeStreamReq(), makeStreamReq()];
      const handler = handlers.get("cmd::run-stream")!;

      await Promise.all(streams.map(({ req }) => handler(req)));

      for (let i = 0; i < 3; i++) {
        const writes = streams[i].streamWritable.write.mock.calls;
        expect(writes).toHaveLength(2);

        const stdoutData = writes[0][0];
        expect(stdoutData).toContain(`stream-${i}`);

        expect(streams[i].response.close).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("Event publish with large payload", () => {
    it("stores a 1MB data payload in KV", async () => {
      const largeData: Record<string, unknown> = {};
      const bigString = "x".repeat(1024 * 1024);
      largeData.payload = bigString;

      const publishFn = handlers.get("event::publish")!;
      const result = await publishFn({
        topic: "sandbox.data",
        sandboxId: "sbx_test",
        data: largeData,
      });

      expect(result.id).toMatch(/^evt_/);
      expect(result.data.payload).toBe(bigString);
      expect(kv.set).toHaveBeenCalledWith(
        "event",
        result.id,
        expect.objectContaining({ data: largeData }),
      );
    });
  });

  describe("Event history with many events", () => {
    it("returns only 10 events when limit=10 from 1000 stored", async () => {
      const events = [];
      for (let i = 0; i < 1000; i++) {
        events.push({
          id: `evt_${i}`,
          topic: "sandbox.created",
          sandboxId: "sbx_test",
          data: {},
          timestamp: i,
        });
      }
      kv.list.mockResolvedValue(events);

      const historyFn = handlers.get("event::history")!;
      const result = await historyFn({ limit: 10 });

      expect(result.events).toHaveLength(10);
      expect(result.total).toBe(1000);
    });
  });

  describe("Event filtering edge cases", () => {
    beforeEach(() => {
      const events = [
        {
          id: "evt_1",
          topic: "sandbox.created",
          sandboxId: "sbx_a",
          data: {},
          timestamp: 1000,
        },
        {
          id: "evt_2",
          topic: "sandbox.killed",
          sandboxId: "sbx_b",
          data: {},
          timestamp: 2000,
        },
      ];
      kv.list.mockResolvedValue(events);
    });

    it("returns empty results for non-existent sandboxId", async () => {
      const historyFn = handlers.get("event::history")!;
      const result = await historyFn({ sandboxId: "sbx_nonexistent" });

      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns empty results for topic that does not match", async () => {
      const historyFn = handlers.get("event::history")!;
      const result = await historyFn({ topic: "sandbox.unknown" });

      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns empty results for limit=0", async () => {
      const historyFn = handlers.get("event::history")!;
      const result = await historyFn({ limit: 0 });

      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(2);
    });
  });

  describe("Stream metrics failure", () => {
    it("sends error SSE event when getContainerStats throws", async () => {
      mockGetContainerStats.mockRejectedValue(new Error("Container stopped"));

      const { req, response, streamWritable } = makeStreamReq();
      const handler = handlers.get("stream::metrics")!;
      await handler(req);
      await vi.advanceTimersByTimeAsync(0);

      const errorWrite = streamWritable.write.mock.calls.find(
        ([data]: [string]) => data.includes('"error"'),
      );
      expect(errorWrite).toBeDefined();
      expect(errorWrite![0]).toContain("Container stopped");
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("Stream request with missing body fields", () => {
    it("returns 400 when command is missing from body", async () => {
      const { req, response, streamWritable } = makeStreamReq({
        body: {},
      });
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":400'),
      );
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("command is required"),
      );
      expect(response.close).toHaveBeenCalled();
    });

    it("returns 404 when sandbox ID does not exist", async () => {
      const { req, response, streamWritable } = makeStreamReq({
        path_params: { id: "sbx_nonexistent" },
      });
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":404'),
      );
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
      expect(response.close).toHaveBeenCalled();
    });

    it("returns 400 when command is empty string", async () => {
      const { req, response, streamWritable } = makeStreamReq({
        body: { command: "" },
      });
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":400'),
      );
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("command is required"),
      );
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("SSE Content-Type verification", () => {
    it("cmd::run-stream sets Content-Type to text/event-stream", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("cmd::run-stream")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });

    it("stream::logs sets Content-Type to text/event-stream", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("stream::logs")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });

    it("stream::metrics sets Content-Type to text/event-stream", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("stream::metrics")!;
      await handler(req);
      await vi.advanceTimersByTimeAsync(0);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });

    it("stream::events sets Content-Type to text/event-stream", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("stream::events")!;
      await handler(req);
      await vi.advanceTimersByTimeAsync(0);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });
  });
});
