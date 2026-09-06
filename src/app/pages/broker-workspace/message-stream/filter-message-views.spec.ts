import { describe, expect, it } from "vitest";

import { MessageView } from "./message-stream";
import { filterMessageViews } from "./filter-message-views";

function view(body: string): MessageView {
  return {
    message: { payload: [], payloadLen: 0, qos: "AtMostOnce", retain: false, receivedAt: 0 },
    timeLabel: "now",
    qos: 0,
    body,
    truncatedNote: null,
    draft: null,
  };
}

describe("filterMessageViews", () => {
  it("returns everything for an empty query", () => {
    const views = [view("hello"), view("world")];
    expect(filterMessageViews(views, "")).toEqual(views);
  });

  it("returns everything for a whitespace-only query", () => {
    const views = [view("hello"), view("world")];
    expect(filterMessageViews(views, "   ")).toEqual(views);
  });

  it("keeps only views whose body contains the query", () => {
    const hello = view("hello there");
    const world = view("world");
    expect(filterMessageViews([hello, world], "there")).toEqual([hello]);
  });

  it("matches case-insensitively", () => {
    const shout = view("HELLO WORLD");
    expect(filterMessageViews([shout], "hello")).toEqual([shout]);
  });

  it("preserves the source order of matches", () => {
    const a = view("aaa-match");
    const b = view("bbb-match");
    const c = view("ccc-other");
    expect(filterMessageViews([a, b, c], "match")).toEqual([a, b]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterMessageViews([view("hello")], "nope")).toEqual([]);
  });
});
