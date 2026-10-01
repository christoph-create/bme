import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ComparePins } from "../../../../core/models/compare-pin.model";
import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { PayloadCompare } from "./payload-compare";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function message(
  text: string,
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  const payload = [...new TextEncoder().encode(text)];
  return {
    payload,
    payloadLen: payload.length,
    qos: "AtMostOnce",
    retain: false,
    properties: null,
    receivedAt: 1_700_000_000_000,
    ...overrides,
  };
}

async function setup(
  messages: readonly StoredMessage[],
  options: { topic?: string | null; pins?: ComparePins | null; wide?: boolean } = {},
) {
  const messages$ = new BehaviorSubject<readonly StoredMessage[]>(messages);
  TestBed.configureTestingModule({
    imports: [PayloadCompare],
    providers: [
      {
        provide: MessageStoreService,
        useValue: { messagesFor: vi.fn().mockReturnValue(messages$) },
      },
    ],
  });

  const fixture = TestBed.createComponent(PayloadCompare);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.componentRef.setInput(
    "selectedTopic",
    options.topic === undefined ? "sensors/climate" : options.topic,
  );
  fixture.componentRef.setInput("pins", options.pins ?? null);
  fixture.componentRef.setInput("wide", options.wide ?? false);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, messages$ };
}

function text(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? "";
}

describe("PayloadCompare", () => {
  it("asks for a topic before anything else", async () => {
    const { fixture } = await setup([], { topic: null });
    expect(fixture.componentInstance.face()).toBe("no-topic");
    expect(text(fixture)).toContain("Select a topic in the tree");
  });

  it("says a selected topic is still quiet", async () => {
    const { fixture } = await setup([]);
    expect(fixture.componentInstance.face()).toBe("no-messages");
    expect(text(fixture)).toContain("No messages on");
  });

  it("says one message is not enough to compare", async () => {
    const { fixture } = await setup([message("{}")]);
    expect(fixture.componentInstance.face()).toBe("single-message");
    expect(text(fixture)).toContain("nothing to compare it against");
  });

  it("diffs the newest two messages with no clicks at all", async () => {
    const { fixture } = await setup([
      message('{"temp":21.5}'),
      message('{"temp":21.8}'),
    ]);
    expect(fixture.componentInstance.face()).toBe("json");
    expect(fixture.nativeElement.querySelector("app-json-diff-table")).toBeTruthy();
    expect(fixture.componentInstance.summary()).toBe("~1  +0  -0");
  });

  it("says it is live until a pin arrives", async () => {
    const { fixture } = await setup([message("ON"), message("OFF")]);
    const chips = [
      ...fixture.nativeElement.querySelectorAll(".mode-chip"),
    ].map((chip: HTMLElement) => chip.textContent?.trim());
    expect(chips).toEqual(["Live"]);
    expect(fixture.componentInstance.pinned()).toBe(false);
  });

  it("freezes the baseline and keeps B on the newest message when pinned", async () => {
    const baseline = message('{"temp":21.0}', { receivedAt: 1 });
    const newest = message('{"temp":21.8}', { receivedAt: 3 });
    const { fixture } = await setup(
      [baseline, message('{"temp":21.5}', { receivedAt: 2 }), newest],
      { pins: { topic: "sensors/climate", a: baseline, b: null, pinnedAt: 0 } },
    );

    expect(fixture.componentInstance.pinned()).toBe(true);
    expect(fixture.componentInstance.selection().before).toBe(baseline);
    expect(fixture.componentInstance.selection().after).toBe(newest);
    expect(text(fixture)).toContain("Pinned");
  });

  it("emits unpin from the chip, which a vanished card cannot offer", async () => {
    const baseline = message("1");
    const { fixture } = await setup([baseline, message("2")], {
      pins: { topic: "sensors/climate", a: baseline, b: null, pinnedAt: 0 },
    });

    const seen: number[] = [];
    fixture.componentInstance.unpinRequested.subscribe(() => seen.push(1));
    fixture.nativeElement.querySelector(".unpin").click();

    expect(seen).toHaveLength(1);
  });

  it("waits for something newer when the pin is on the newest message", async () => {
    const only = message("{}");
    const { fixture } = await setup([only], {
      pins: { topic: "sensors/climate", a: only, b: null, pinnedAt: 0 },
    });
    expect(fixture.componentInstance.face()).toBe("awaiting-newer");
    expect(text(fixture)).toContain("Baseline pinned");
  });

  it("ignores a pin taken on another topic", async () => {
    const stranger = message("x");
    const { fixture } = await setup([message("ON"), message("OFF")], {
      pins: { topic: "somewhere/else", a: stranger, b: null, pinnedAt: 0 },
    });
    expect(fixture.componentInstance.pinned()).toBe(false);
    expect(fixture.componentInstance.face()).toBe("lines");
  });

  it("says so in one line when the payloads match", async () => {
    const { fixture } = await setup([message('{"a":1}'), message('{"a":1}')]);
    expect(fixture.componentInstance.face()).toBe("identical");
    expect(text(fixture)).toContain("Identical payloads");
  });

  it("explains a side it cannot diff, in Resend's words", async () => {
    const binary = message("", { payload: [0xff, 0xfe, 0xff, 0xfe], payloadLen: 4 });
    const { fixture } = await setup([message('{"a":1}'), binary]);
    expect(fixture.componentInstance.face()).toBe("not-diffable");
    expect(text(fixture)).toContain("This payload isn't text");
  });

  it("falls back to a line diff and says why when only one side is JSON", async () => {
    const { fixture } = await setup([message('{"a":1}'), message("ON")]);
    expect(fixture.componentInstance.face()).toBe("lines");
    expect(fixture.componentInstance.mixedFormats()).toBe(true);
    expect(text(fixture)).toContain("One side isn't JSON");
  });

  it("falls back quietly when neither side is JSON", async () => {
    const { fixture } = await setup([message("ON"), message("OFF")]);
    expect(fixture.componentInstance.face()).toBe("lines");
    expect(fixture.componentInstance.mixedFormats()).toBe(false);
    expect(text(fixture)).not.toContain("One side isn't JSON");
  });

  it("labels a backwards diff rather than silently reordering the columns", async () => {
    const newer = message('{"a":2}', { receivedAt: 2_000 });
    const older = message('{"a":1}', { receivedAt: 1_000 });
    const { fixture } = await setup([older, newer], {
      pins: { topic: "sensors/climate", a: newer, b: older, pinnedAt: 0 },
    });
    expect(fixture.componentInstance.reversed()).toBe(true);
    expect(text(fixture)).toContain("baseline is newer");
  });

  it("buffers what arrives while paused, then catches up on resume", async () => {
    const { fixture, messages$ } = await setup([
      message('{"temp":21.5}'),
      message('{"temp":21.8}'),
    ]);
    fixture.componentRef.setInput("paused", true);
    fixture.detectChanges();

    messages$.next([
      message('{"temp":21.5}'),
      message('{"temp":21.8}'),
      message('{"temp":30.0}'),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.selection().after?.payload).toEqual(
      [...new TextEncoder().encode('{"temp":21.8}')],
    );
    expect(text(fixture)).toContain("Paused");
    expect(fixture.componentInstance.afterRole()).toBe("latest (paused)");

    fixture.componentRef.setInput("paused", false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.selection().after?.payload).toEqual(
      [...new TextEncoder().encode('{"temp":30.0}')],
    );
  });

  it("resubscribes when the selected topic changes", async () => {
    const messagesFor = vi.fn().mockReturnValue(of([]));
    TestBed.configureTestingModule({
      imports: [PayloadCompare],
      providers: [{ provide: MessageStoreService, useValue: { messagesFor } }],
    });
    const fixture = TestBed.createComponent(PayloadCompare);
    fixture.componentRef.setInput("connectionId", CONNECTION_ID);
    fixture.componentRef.setInput("selectedTopic", "a/b");
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentRef.setInput("selectedTopic", "c/d");
    fixture.detectChanges();
    await fixture.whenStable();

    expect(messagesFor.mock.calls.map((call) => call[1])).toEqual(["a/b", "c/d"]);
  });

  it("hands the dock's width verdict down to the field table", async () => {
    const { fixture } = await setup(
      [message('{"a":1}'), message('{"a":2}')],
      { wide: true },
    );
    const table = fixture.debugElement.query(
      (node: { name?: string }) => node.name === "app-json-diff-table",
    );
    expect(table.componentInstance.wide()).toBe(true);
  });
});
