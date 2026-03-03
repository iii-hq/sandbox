import { describe, it, expect } from "vitest";
import { generateId, SCOPES } from "../../packages/engine/src/state/schema.js";

describe("SCOPES", () => {
  it("has sandbox scope", () => {
    expect(SCOPES.SANDBOXES).toBe("sandbox");
  });

  it("has metrics scope", () => {
    expect(SCOPES.METRICS).toBe("metrics");
  });

  it("has global scope", () => {
    expect(SCOPES.GLOBAL).toBe("global");
  });

  it("has background scope", () => {
    expect(SCOPES.BACKGROUND).toBe("background");
  });

  it("has expected number of scopes", () => {
    expect(Object.keys(SCOPES).length).toBeGreaterThanOrEqual(4);
  });

  it("scope values are lowercase strings", () => {
    for (const value of Object.values(SCOPES)) {
      expect(value).toBe(value.toLowerCase());
    }
  });
});

describe("generateId", () => {
  it("generates ID with default prefix", () => {
    const id = generateId();
    expect(id).toMatch(/^sbx_[a-f0-9]{24}$/);
  });

  it("generates ID with custom prefix", () => {
    const id = generateId("bg");
    expect(id).toMatch(/^bg_[a-f0-9]{24}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it("generates IDs with consistent length", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId("test");
      expect(id.length).toBe(4 + 1 + 24);
    }
  });

  it("default prefix is sbx", () => {
    const id = generateId();
    expect(id.startsWith("sbx_")).toBe(true);
  });

  it("prefix is separated by underscore", () => {
    const id = generateId("abc");
    expect(id.charAt(3)).toBe("_");
  });

  it("hex portion contains only valid hex chars", () => {
    for (let i = 0; i < 100; i++) {
      const hex = generateId().split("_")[1];
      expect(hex).toMatch(/^[a-f0-9]+$/);
    }
  });

  it("single char prefix works", () => {
    const id = generateId("x");
    expect(id).toMatch(/^x_[a-f0-9]{24}$/);
  });

  it("empty string prefix works", () => {
    const id = generateId("");
    expect(id).toMatch(/^_[a-f0-9]{24}$/);
  });
});
