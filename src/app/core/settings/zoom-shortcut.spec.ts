import { describe, expect, it } from "vitest";

import { zoomActionFor } from "./zoom-shortcut";

function press(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">
  > = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...modifiers });
}

describe("zoomActionFor", () => {
  it.each([
    ["=", "in"],
    ["+", "in"],
    ["-", "out"],
    ["_", "out"],
    ["0", "reset"],
  ])("maps Ctrl+%s to %s", (key, action) => {
    expect(zoomActionFor(press(key, { ctrlKey: true }))).toBe(action);
  });

  it("accepts Shift, since + is Shift+= on most layouts", () => {
    expect(zoomActionFor(press("+", { ctrlKey: true, shiftKey: true }))).toBe(
      "in",
    );
  });

  it("accepts Cmd as the modifier too", () => {
    expect(zoomActionFor(press("0", { metaKey: true }))).toBe("reset");
  });

  it("ignores the same keys without a modifier", () => {
    for (const key of ["=", "+", "-", "_", "0"]) {
      expect(zoomActionFor(press(key))).toBeNull();
    }
  });

  it("ignores Ctrl+Alt, which is a different chord", () => {
    expect(
      zoomActionFor(press("0", { ctrlKey: true, altKey: true })),
    ).toBeNull();
  });

  it("ignores other Ctrl combinations", () => {
    for (const key of ["f", "s", "1", "9", "ArrowUp", "Enter"]) {
      expect(zoomActionFor(press(key, { ctrlKey: true }))).toBeNull();
    }
  });
});
