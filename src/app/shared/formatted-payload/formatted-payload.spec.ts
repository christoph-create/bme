import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { MessageFormat } from "../../core/models/message-format.model";
import { FormattedPayload } from "./formatted-payload";

async function setup(
  payload: string,
  format: MessageFormat = "json",
  prettyPrint = true,
  highlight = "",
) {
  TestBed.configureTestingModule({ imports: [FormattedPayload] });

  const fixture = TestBed.createComponent(FormattedPayload);
  fixture.componentRef.setInput("payload", payload);
  fixture.componentRef.setInput("format", format);
  fixture.componentRef.setInput("prettyPrint", prettyPrint);
  fixture.componentRef.setInput("highlight", highlight);
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

  describe("highlight", () => {
    it("marks no spans when highlight is empty", async () => {
      const { fixture } = await setup('{"a":1}', "json", true, "");

      expect(spanClasses(fixture).some((classes) => classes.includes("match"))).toBe(
        false,
      );
    });

    it("splits a matching token and marks the matched segment", async () => {
      const { fixture } = await setup('{"data":"hello"}', "json", false, "ell");

      const spans = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll("span"),
      );
      const matched = spans.find((el) => el.classList.contains("match"));
      expect(matched?.textContent).toBe("ell");
      // The surrounding text keeps the same syntax kind as the token it split from.
      expect(matched?.classList.contains("tok-string")).toBe(true);
      expect(
        spans.some(
          (el) => el.textContent === "\"h" && el.classList.contains("tok-string"),
        ),
      ).toBe(true);
    });

    it("matches case-insensitively", async () => {
      const { fixture } = await setup("plain text", "raw", true, "TEXT");

      const matched = (fixture.nativeElement as HTMLElement).querySelector(
        "span.match",
      );
      expect(matched?.textContent).toBe("text");
    });
  });
});
