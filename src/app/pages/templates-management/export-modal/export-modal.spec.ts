import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ExchangeDocument,
  TemplateDocument,
} from "../../../core/models/template-exchange.model";
import { ExportModal } from "./export-modal";

const DOCUMENT: TemplateDocument = {
  specVersion: "1.0",
  kind: "template",
  template: {
    name: "Turn fan on",
    description: null,
    topic: "home/livingroom/fan/set",
    payload: '{"state":"on"}',
    format: "json",
    qos: 1,
    retain: false,
  },
};

function setup(document: ExchangeDocument = DOCUMENT) {
  TestBed.configureTestingModule({ imports: [ExportModal] });
  const fixture = TestBed.createComponent(ExportModal);
  fixture.componentRef.setInput("document", document);
  fixture.detectChanges();
  return { fixture };
}

describe("ExportModal", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the title for the document kind", () => {
    const { fixture } = setup();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Export Template",
    );
  });

  it("shows the serialized document, pretty-printed", () => {
    const { fixture } = setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain('"kind": "template"');
    expect(text).toContain('"topic": "home/livingroom/fan/set"');
  });

  it("uses Export Collection / Export All Templates titles for the other kinds", () => {
    const { fixture } = setup({
      specVersion: "1.0",
      kind: "collection",
      collection: { name: "Living room", description: null },
      templates: [],
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Export Collection",
    );
  });

  it("copies the serialized document to the clipboard and shows confirmation", async () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    await component.copyToClipboard();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith(component.serialized());
    expect(component.copied()).toBe(true);
  });

  it("emits close when Close is clicked", () => {
    const { fixture } = setup();
    const close_modal = vi.fn();
    fixture.componentInstance.close_modal.subscribe(close_modal);

    const closeButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Close");
    (closeButton as HTMLElement).click();

    expect(close_modal).toHaveBeenCalledOnce();
  });
});
