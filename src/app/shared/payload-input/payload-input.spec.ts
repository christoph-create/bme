import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageFormat } from "../../core/models/message-format.model";
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
