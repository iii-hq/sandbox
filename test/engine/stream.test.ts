import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("iii-sdk", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    getContext: () => ({ logger: { info: vi.fn(), warn: vi.fn() } }),
  };
});

const mockGetDocker = vi.fn();
const mockGetContainerStats = vi.fn();

vi.mock("../../packages/engine/src/docker/client.js", () => ({
  getDocker: () => mockGetDocker(),
  getContainerStats: (...args: any[]) => mockGetContainerStats(...args),
}));

import { registerStreamFunctions } from "../../packages/engine/src/functions/stream.js";
import type { EngineConfig } from "../../packages/engine/src/config.js";

describe("Stream Functions", () => {
  let handlers: Map<string, Function>;
  let kvStore: Map<string, any>;
  let eventStore: any[];

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
    maxFileSize: 10485760,
    cleanupOnExit: true,
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
    };
    return {
      req: {
        path_params: { id: "sbx_test" },
        query_params: {},
        body: {},
        headers: {},
        method: "GET",
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
    eventStore = [];
    kvStore.set("sbx_test", runningSandbox);

    const kv = {
      get: vi.fn(
        async (_scope: string, key: string) => kvStore.get(key) ?? null,
      ),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(async () => eventStore),
    };

    const sdk = {
      registerFunction: vi.fn((meta: any, handler: Function) => {
        handlers.set(meta.id, handler);
      }),
      registerTrigger: vi.fn(),
    };

    const mockLogStream = {
      on: vi.fn((event: string, cb: Function) => {
        if (event === "data") {
          const buf = Buffer.from(
            "\x01\x00\x00\x00\x00\x00\x00\x0bhello world",
          );
          cb(buf);
        }
        if (event === "end") {
          setTimeout(() => cb(), 0);
        }
      }),
    };

    mockGetDocker.mockReturnValue({
      getContainer: () => ({
        id: "container-1",
        logs: vi.fn().mockResolvedValue(mockLogStream),
      }),
    });

    mockGetContainerStats.mockResolvedValue({
      sandboxId: "sbx_test",
      cpuPercent: 5.2,
      memoryUsageMb: 128,
      memoryLimitMb: 512,
      networkRxBytes: 0,
      networkTxBytes: 0,
      pids: 3,
    });

    registerStreamFunctions(sdk, kv as any, config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers 3 stream functions", () => {
    expect(handlers.has("stream::logs")).toBe(true);
    expect(handlers.has("stream::metrics")).toBe(true);
    expect(handlers.has("stream::events")).toBe(true);
  });

  describe("stream::logs", () => {
    it("returns 404 for non-existent sandbox", async () => {
      const { req, response, streamWritable } = makeStreamReq({
        path_params: { id: "sbx_missing" },
      });
      const handler = handlers.get("stream::logs")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":404'),
      );
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
      expect(response.close).toHaveBeenCalled();
    });

    it("returns 400 for non-running sandbox", async () => {
      kvStore.set("sbx_paused", {
        ...runningSandbox,
        id: "sbx_paused",
        status: "paused",
      });
      const { req, response, streamWritable } = makeStreamReq({
        path_params: { id: "sbx_paused" },
      });
      const handler = handlers.get("stream::logs")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":400'),
      );
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("not running"),
      );
    });

    it("sets SSE headers", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("stream::logs")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });

    it("streams log data as SSE events", async () => {
      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("stream::logs")!;
      await handler(req);

      const writes = streamWritable.write.mock.calls;
      const hasDataLine = writes.some(([data]: [string]) =>
        data.startsWith("data: "),
      );
      expect(hasDataLine).toBe(true);
    });

    it("handles auth when authToken is set", async () => {
      const configWithAuth = { ...config, authToken: "secret" };
      const handlersAuth = new Map<string, Function>();
      const kv = {
        get: vi.fn(async (_s: string, k: string) => kvStore.get(k) ?? null),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      };
      const sdkMock = {
        registerFunction: vi.fn((meta: any, handler: Function) => {
          handlersAuth.set(meta.id, handler);
        }),
      };
      registerStreamFunctions(sdkMock, kv as any, configWithAuth);

      const { req, response } = makeStreamReq({ headers: {} });
      const handler = handlersAuth.get("stream::logs")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":401'),
      );
      expect(response.close).toHaveBeenCalled();
    });
  });

  describe("stream::metrics", () => {
    it("returns 404 for non-existent sandbox", async () => {
      const { req, response, streamWritable } = makeStreamReq({
        path_params: { id: "sbx_missing" },
      });
      const handler = handlers.get("stream::metrics")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":404'),
      );
      expect(streamWritable.write).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
    });

    it("sets SSE headers", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("stream::metrics")!;
      await handler(req);
      await vi.advanceTimersByTimeAsync(0);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });

    it("streams metrics data as SSE", async () => {
      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("stream::metrics")!;
      await handler(req);
      await vi.advanceTimersByTimeAsync(0);

      const writes = streamWritable.write.mock.calls;
      const hasMetrics = writes.some(([data]: [string]) =>
        data.includes("cpuPercent"),
      );
      expect(hasMetrics).toBe(true);
    });

    it("enforces minimum interval of 1 second", async () => {
      const { req, response } = makeStreamReq({
        query_params: { interval: "0" },
      });
      const handler = handlers.get("stream::metrics")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"status_code":200'),
      );
    });
  });

  describe("stream::events", () => {
    it("sets SSE headers", async () => {
      const { req, response } = makeStreamReq();
      const handler = handlers.get("stream::events")!;
      await handler(req);

      expect(response.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('"text/event-stream"'),
      );
    });

    it("streams events via registered handler", async () => {
      const { req, streamWritable } = makeStreamReq();
      const handler = handlers.get("stream::events")!;
      await handler(req);

      const eventHandlerKey = Array.from(handlers.keys()).find((k) =>
        k.startsWith("stream-events-"),
      );
      expect(eventHandlerKey).toBeDefined();

      const eventHandler = handlers.get(eventHandlerKey!)!;
      await eventHandler({
        id: "evt_1",
        topic: "sandbox.created",
        sandboxId: "sbx_test",
        data: {},
        timestamp: Date.now() + 1000,
      });

      const writes = streamWritable.write.mock.calls;
      const hasEvent = writes.some(([data]: [string]) =>
        data.includes("sandbox.created"),
      );
      expect(hasEvent).toBe(true);
    });

    it("filters events by topic", async () => {
      const { req, streamWritable } = makeStreamReq({
        query_params: { topic: "sandbox.created" },
      });
      const handler = handlers.get("stream::events")!;
      await handler(req);

      const eventHandlerKey = Array.from(handlers.keys()).find((k) =>
        k.startsWith("stream-events-"),
      );
      const eventHandler = handlers.get(eventHandlerKey!)!;

      await eventHandler({
        id: "evt_1",
        topic: "sandbox.created",
        sandboxId: "sbx_test",
        data: {},
        timestamp: Date.now() + 1000,
      });
      await eventHandler({
        id: "evt_2",
        topic: "sandbox.killed",
        sandboxId: "sbx_test",
        data: {},
        timestamp: Date.now() + 2000,
      });

      const writes = streamWritable.write.mock.calls;
      const hasCreated = writes.some(([data]: [string]) =>
        data.includes("sandbox.created"),
      );
      const hasKilled = writes.some(([data]: [string]) =>
        data.includes("sandbox.killed"),
      );
      expect(hasCreated).toBe(true);
      expect(hasKilled).toBe(false);
    });
  });
});
