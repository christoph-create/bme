import { describe, expect, it } from "vitest";

import { randomClientId } from "./client-id";

describe("randomClientId", () => {
  it("matches the bme-<6 lowercase alphanumeric chars> shape", () => {
    expect(randomClientId()).toMatch(/^bme-[a-z0-9]{6}$/);
  });

  it("varies across calls", () => {
    const ids = new Set(Array.from({ length: 10 }, () => randomClientId()));

    expect(ids.size).toBeGreaterThan(1);
  });
});
