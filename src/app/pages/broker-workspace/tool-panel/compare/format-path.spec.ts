import { describe, expect, it } from "vitest";

import { formatPath } from "./format-path";

describe("formatPath", () => {
  it("labels the empty path as the root", () => {
    expect(formatPath([])).toBe("(root)");
  });

  it("joins bare identifiers with dots", () => {
    expect(formatPath(["battery", "level"])).toBe("battery.level");
  });

  it("writes whole-number steps as indices", () => {
    expect(formatPath(["items", "0", "id"])).toBe("items[0].id");
  });

  it("does not put a leading dot on a first bare step", () => {
    expect(formatPath(["temp"])).toBe("temp");
  });

  it("brackets a dotted key so it cannot read as two steps", () => {
    expect(formatPath(["a.b"])).toBe('["a.b"]');
    expect(formatPath(["a.b"])).not.toBe(formatPath(["a", "b"]));
  });

  it("brackets an empty key", () => {
    expect(formatPath([""])).toBe('[""]');
  });

  it("brackets a key that starts with a digit", () => {
    expect(formatPath(["2fa"])).toBe('["2fa"]');
  });

  it("escapes a quote inside a key", () => {
    expect(formatPath(['say"hi'])).toBe('["say\\"hi"]');
  });

  it("keeps $ and _ as bare identifiers, as JavaScript does", () => {
    expect(formatPath(["$sys", "_id"])).toBe("$sys._id");
  });
});
