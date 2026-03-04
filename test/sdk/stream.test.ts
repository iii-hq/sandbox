import { describe, it, expect } from "vitest";
import { parseExecStream } from "../../packages/sdk/src/stream.js";

describe("parseExecStream", () => {
  it("parses valid JSON chunks", async () => {
    async function* gen() {
      yield '{"type":"stdout","data":"hello","timestamp":1000}';
      yield '{"type":"stderr","data":"warn","timestamp":1001}';
      yield '{"type":"exit","data":"0","timestamp":1002}';
    }

    const chunks = [];
    for await (const chunk of parseExecStream(gen())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({
      type: "stdout",
      data: "hello",
      timestamp: 1000,
    });
    expect(chunks[1]).toEqual({
      type: "stderr",
      data: "warn",
      timestamp: 1001,
    });
    expect(chunks[2]).toEqual({ type: "exit", data: "0", timestamp: 1002 });
  });

  it("stops on exit chunk", async () => {
    async function* gen() {
      yield '{"type":"stdout","data":"line1","timestamp":1}';
      yield '{"type":"exit","data":"0","timestamp":2}';
      yield '{"type":"stdout","data":"should-not-appear","timestamp":3}';
    }

    const chunks = [];
    for await (const chunk of parseExecStream(gen())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[1].type).toBe("exit");
  });

  it("skips non-JSON lines", async () => {
    async function* gen() {
      yield "plain text line";
    }

    const chunks = [];
    for await (const chunk of parseExecStream(gen())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(0);
  });

  it("handles empty generator", async () => {
    async function* gen() {
      // empty
    }

    const chunks = [];
    for await (const chunk of parseExecStream(gen())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(0);
  });

  it("skips plain text and parses valid JSON", async () => {
    async function* gen() {
      yield '{"type":"stdout","data":"json line","timestamp":1}';
      yield "plain text";
      yield '{"type":"exit","data":"0","timestamp":2}';
    }

    const chunks = [];
    for await (const chunk of parseExecStream(gen())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].data).toBe("json line");
    expect(chunks[1].type).toBe("exit");
  });
});
