import { describe, expect, it } from "vitest";

import { prettyPayload } from "./pretty-payload";

describe("prettyPayload", () => {
  it("pretty-prints valid JSON when format is json", () => {
    expect(prettyPayload('{"a":1,"b":[1,2]}', "json")).toBe(
      JSON.stringify({ a: 1, b: [1, 2] }, null, 2),
    );
  });

  it("returns the raw payload unchanged when format is raw", () => {
    expect(prettyPayload('{"a":1}', "raw")).toBe('{"a":1}');
  });

  it("falls back to the raw payload when format is json but it doesn't parse", () => {
    expect(prettyPayload("not json", "json")).toBe("not json");
  });

  it("returns an empty string unchanged", () => {
    expect(prettyPayload("", "json")).toBe("");
  });
});
