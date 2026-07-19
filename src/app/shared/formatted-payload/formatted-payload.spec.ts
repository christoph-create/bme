import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { MessageFormat } from "../../core/models/message-format.model";
import { FormattedPayload } from "./formatted-payload";

async function setup(
  payload: string,
  format: MessageFormat = "json",
  prettyPrint = true,
) {
  TestBed.configureTestingModule({ imports: [FormattedPayload] });

  const fixture = TestBed.createComponent(FormattedPayload);
  fixture.componentRef.setInput("payload", payload);
  fixture.componentRef.setInput("format", format);
  fixture.componentRef.setInput("prettyPrint", prettyPrint);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture };
}

function text(fixture: { nativeElement: unknown }): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? "";
}

function spanClasses(fixture: { nativeElement: unknown }): string[][] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll("span"),
  ).map((el) => Array.from(el.classList));
}

describe("FormattedPayload", () => {
  it("pretty-prints and tokenizes a JSON payload", async () => {
    const { fixture } = await setup('{"a":1}', "json");

    expect(text(fixture)).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(spanClasses(fixture)).toContainEqual(["tok", "tok-key"]);
    expect(spanClasses(fixture)).toContainEqual(["tok", "tok-number"]);
  });

  it("shows raw payloads as plain text without tokenizing", async () => {
    const { fixture } = await setup('{"a":1}', "raw");

    expect(text(fixture)).toBe('{"a":1}');
    expect(spanClasses(fixture)).toEqual([["tok", "tok-plain"]]);
  });

  it("leaves invalid JSON unchanged instead of failing", async () => {
    const { fixture } = await setup("not json", "json");

    expect(text(fixture)).toBe("not json");
  });

  it("skips pretty-printing when prettyPrint is false, but still tokenizes", async () => {
    const { fixture } = await setup('{"a":1}', "json", false);

    expect(text(fixture)).toBe('{"a":1}');
    expect(spanClasses(fixture)).toContainEqual(["tok", "tok-key"]);
  });
});
