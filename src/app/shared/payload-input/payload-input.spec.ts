import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageFormat } from "../../core/models/message-format.model";
import { VariableValueKind } from "../../core/models/payload-variable.model";
import { PayloadInput } from "./payload-input";

async function setup(format: MessageFormat = "json") {
  TestBed.configureTestingModule({ imports: [PayloadInput] });

  const fixture = TestBed.createComponent(PayloadInput);
  fixture.componentRef.setInput("format", format);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const onChange = vi.fn();
  const onTouched = vi.fn();
  fixture.componentInstance.registerOnChange(onChange);
  fixture.componentInstance.registerOnTouched(onTouched);

  return { fixture, component: fixture.componentInstance, onChange, onTouched };
}

/** True when the Format action is the clickable one rather than the greyed
 * out span - i.e. what the user actually sees. */
function formatEnabled(fixture: { nativeElement: unknown }): boolean {
  const action = (fixture.nativeElement as HTMLElement).querySelector(
    ".format-action",
  );
  return action !== null && !action.classList.contains("disabled");
}

function editorText(fixture: { nativeElement: unknown }): string {
  const lines = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(".cm-line"),
  );
  return lines.map((line) => line.textContent ?? "").join("\n");
}

describe("PayloadInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("json format", () => {
    it("shows the Format action and a CodeMirror editor, no plain textarea", async () => {
      const { fixture } = await setup("json");

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(".format-action"),
      ).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(".cm-editor"),
      ).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector("textarea"),
      ).toBeNull();
    });

    it("renders the value passed via writeValue in the editor", async () => {
      const { fixture, component } = await setup("json");

      component.writeValue('{"a":1}');
      fixture.detectChanges();

      expect(editorText(fixture)).toBe('{"a":1}');
    });

    it("pretty-prints valid JSON and notifies the form control when Format is clicked", async () => {
      const { fixture, component, onChange } = await setup("json");
      component.writeValue('{"a": 1,   "b": 2}');
      fixture.detectChanges();

      component.formatPayload();
      fixture.detectChanges();

      const expected = JSON.stringify({ a: 1, b: 2 }, null, 2);
      expect(editorText(fixture)).toBe(expected);
      expect(onChange).toHaveBeenCalledWith(expected);
    });

    it("leaves the content untouched when Format is clicked on invalid JSON", async () => {
      const { fixture, component, onChange } = await setup("json");
      component.writeValue("not valid json");
      fixture.detectChanges();

      component.formatPayload();
      fixture.detectChanges();

      expect(editorText(fixture)).toBe("not valid json");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("shows a live error as soon as the content is invalid, without clicking Format", async () => {
      const { component } = await setup("json");

      component.writeValue("not valid json");

      expect(component.formatError()).toBe("Payload isn't valid JSON");
    });

    it("clears the live error as soon as the content becomes valid again", async () => {
      const { component } = await setup("json");
      component.writeValue("not valid json");
      expect(component.formatError()).toBeTruthy();

      component.writeValue('{"a":1}');

      expect(component.formatError()).toBeNull();
    });

    it("shows no error for an empty (untouched) field", async () => {
      const { component } = await setup("json");

      component.writeValue("");

      expect(component.formatError()).toBeNull();
    });

    it("offers Format for valid JSON and withholds it otherwise", async () => {
      const { fixture, component } = await setup("json");

      component.writeValue('{"a": 1}');
      fixture.detectChanges();
      expect(formatEnabled(fixture)).toBe(true);

      component.writeValue("not valid json");
      fixture.detectChanges();
      expect(formatEnabled(fixture)).toBe(false);
    });

    it("withholds Format for an empty field, with a reason", async () => {
      const { fixture, component } = await setup("json");

      component.writeValue("");
      fixture.detectChanges();

      expect(formatEnabled(fixture)).toBe(false);
      expect(component.formatUnavailableReason()).toBe("Nothing to format yet");
    });
  });

  describe("raw format", () => {
    it("shows a plain textarea, no Format action or editor", async () => {
      const { fixture } = await setup("raw");

      expect(
        (fixture.nativeElement as HTMLElement).querySelector("textarea"),
      ).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(".format-action"),
      ).toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(".cm-editor"),
      ).toBeNull();
    });

    it("renders the value passed via writeValue in the textarea", async () => {
      const { fixture, component } = await setup("raw");

      component.writeValue("hello");
      fixture.detectChanges();

      const textarea = (fixture.nativeElement as HTMLElement).querySelector(
        "textarea",
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("hello");
    });

    it("notifies the form control on input, verbatim, without any JSON handling", async () => {
      const { fixture, onChange } = await setup("raw");
      const textarea = (fixture.nativeElement as HTMLElement).querySelector(
        "textarea",
      ) as HTMLTextAreaElement;

      textarea.value = "not json { at all";
      textarea.dispatchEvent(new Event("input"));
      fixture.detectChanges();

      expect(onChange).toHaveBeenCalledWith("not json { at all");
    });

    it("calls registerOnTouched's callback on blur", async () => {
      const { fixture, onTouched } = await setup("raw");
      const textarea = (fixture.nativeElement as HTMLElement).querySelector(
        "textarea",
      ) as HTMLTextAreaElement;

      textarea.dispatchEvent(new Event("blur"));

      expect(onTouched).toHaveBeenCalled();
    });
  });
});

describe("PayloadInput with variables in scope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `xxx` is a UUID (string), `tempC` a random int (number) - the two value
   * kinds probe expansion has to distinguish. */
  const kinds: ReadonlyMap<string, VariableValueKind> = new Map([
    ["xxx", "string"],
    ["tempC", "number"],
  ]);

  async function withKinds(value: string) {
    const { fixture, component } = await setup("json");
    fixture.componentRef.setInput("placeholderKinds", kinds);
    component.writeValue(value);
    fixture.detectChanges();
    return { fixture, component };
  }

  it("accepts a defined numeric variable in a value position", async () => {
    const { component } = await withKinds('{"t":{{tempC}}}');

    expect(component.formatError()).toBeNull();
  });

  it("accepts a defined string variable inside quotes", async () => {
    const { component } = await withKinds('{"id":"{{xxx}}"}');

    expect(component.formatError()).toBeNull();
  });

  it("names the undefined variable instead of only saying the JSON is bad", async () => {
    // The case from the bug report: "number" was never defined, so it stays
    // literal and the payload really isn't valid JSON - but "Payload isn't
    // valid JSON" alone sends you hunting for a syntax error that isn't there.
    const { component } = await withKinds(
      '{"uuid":"{{xxx}}","number":{{number}}}',
    );

    expect(component.formatError()).toBe(
      "Payload isn't valid JSON — there is no variable named \"number\"",
    );
  });

  it("names several undefined variables", async () => {
    const { component } = await withKinds('{"a":{{one}},"b":{{two}}}');

    expect(component.formatError()).toBe(
      "Payload isn't valid JSON — there are no variables named \"one\", \"two\"",
    );
  });

  it("keeps the plain message when the JSON is broken for an ordinary reason", async () => {
    const { component } = await withKinds('{"t":{{tempC}},}');

    expect(component.formatError()).toBe("Payload isn't valid JSON");
  });

  it("reports an unknown name even where the JSON still parses", async () => {
    const { component } = await withKinds('{"id":"{{typo}}"}');

    expect(component.formatError()).toBeNull();
    expect(component.unknownVariables()).toEqual(["typo"]);
  });

  it("reports nothing unknown when no kinds are supplied at all", async () => {
    // Every other caller of PayloadInput passes nothing, and must keep the
    // old literal-JSON behaviour.
    const { fixture, component } = await setup("json");
    component.writeValue('{"id":"{{typo}}"}');
    fixture.detectChanges();

    expect(component.unknownVariables()).toEqual([]);
    expect(component.formatError()).toBeNull();
  });

  it("still rejects a placeholder-free payload that is genuinely invalid", async () => {
    const { component } = await withKinds("not json");

    expect(component.formatError()).toBe("Payload isn't valid JSON");
  });

  it("offers Format for a payload that uses variables", async () => {
    // The headline fix: Format used to be disabled the moment a payload
    // contained `{{anything}}`, which is exactly when hand-indenting is worst.
    const { fixture } = await withKinds('{"t":{{tempC}}}');

    expect(formatEnabled(fixture)).toBe(true);
  });

  it("pretty-prints the payload from the bug report, variables intact", async () => {
    const { fixture, component } = await withKinds(
      '{\n  "data1": {{tempC}},\n"data2": {{tempC}},\n"data3": {{tempC}}\n}',
    );
    const onChange = vi.fn();
    component.registerOnChange(onChange);

    component.formatPayload();
    fixture.detectChanges();

    const expected = [
      "{",
      '  "data1": {{tempC}},',
      '  "data2": {{tempC}},',
      '  "data3": {{tempC}}',
      "}",
    ].join("\n");
    expect(editorText(fixture)).toBe(expected);
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it("withholds Format for a bare placeholder in key position", async () => {
    // Invalid however it expands, and Format must never contradict the error
    // line the component is showing right next to it.
    const { fixture, component } = await withKinds("{ {{tempC}}: 1 }");

    expect(component.formatError()).not.toBeNull();
    expect(formatEnabled(fixture)).toBe(false);
  });

  it("withholds Format for an undefined variable in a value position", async () => {
    const { fixture } = await withKinds('{"t":{{typo}}}');

    expect(formatEnabled(fixture)).toBe(false);
  });

  it("withholds Format when a placeholder can't be masked, saying so", async () => {
    // `1{{tempC}}` expands to the valid `10`, so the error line stays quiet -
    // but there is no stand-in that makes the literal text parse, so clicking
    // Format would do nothing. The tooltip has to explain the difference.
    const { fixture, component } = await withKinds('{"t": 1{{tempC}}}');

    expect(component.formatError()).toBeNull();
    expect(formatEnabled(fixture)).toBe(false);
    expect(component.formatUnavailableReason()).toBe(
      "Formatting can't preserve this payload's variables",
    );
  });
});
