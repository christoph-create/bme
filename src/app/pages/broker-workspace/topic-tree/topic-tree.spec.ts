import { TestBed } from "@angular/core/testing";
import { Subject, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../core/services/message-store.service";
import { TopicTree } from "./topic-tree";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    payload: [1, 2, 3],
    qos: "AtMostOnce",
    retain: false,
    receivedAt: Date.now() - 12_000,
    ...overrides,
  };
}

async function setup(
  topics: ReadonlyMap<string, readonly StoredMessage[]>,
) {
  const topicsFor = vi.fn().mockReturnValue(of(topics));

  TestBed.configureTestingModule({
    imports: [TopicTree],
    providers: [{ provide: MessageStoreService, useValue: { topicsFor } }],
  });

  const fixture = TestBed.createComponent(TopicTree);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, topicsFor };
}

function setupStreaming() {
  const topics$ = new Subject<ReadonlyMap<string, readonly StoredMessage[]>>();
  const topicsFor = vi.fn().mockReturnValue(topics$);

  TestBed.configureTestingModule({
    imports: [TopicTree],
    providers: [{ provide: MessageStoreService, useValue: { topicsFor } }],
  });

  const fixture = TestBed.createComponent(TopicTree);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();

  return { fixture, topics$ };
}

describe("TopicTree", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the total distinct-topic count in the header", async () => {
    const { fixture } = await setup(
      new Map([
        ["home/livingroom/temperature", [message()]],
        ["home/kitchen/humidity", [message()]],
        ["device", [message()]],
      ]),
    );

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Topics · 3");
  });

  it("starts with folders collapsed, and expanding one reveals its children", async () => {
    const { fixture } = await setup(
      new Map([["sensors/temp", [message()]]]),
    );
    const component = fixture.componentInstance;

    let text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("temp");

    component.toggleFolder("sensors");
    fixture.detectChanges();

    text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("temp");

    component.toggleFolder("sensors");
    fixture.detectChanges();

    text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("temp");
  });

  it("expand all reveals every leaf and flips the toggle label; collapse all hides them again", async () => {
    const { fixture } = await setup(
      new Map([
        ["sensors/temp", [message()]],
        ["device/battery", [message()]],
      ]),
    );
    const component = fixture.componentInstance;

    expect(component.allExpanded()).toBe(false);

    component.toggleExpandAll();
    fixture.detectChanges();

    expect(component.allExpanded()).toBe(true);
    let text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("temp");
    expect(text).toContain("battery");
    expect(text).toContain("Collapse all");

    component.toggleExpandAll();
    fixture.detectChanges();

    expect(component.allExpanded()).toBe(false);
    text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("temp");
    expect(text).not.toContain("battery");
    expect(text).toContain("Expand all");
  });

  it("selecting a leaf emits topicSelected and highlights it", async () => {
    const { fixture } = await setup(new Map([["device", [message()]]]));
    const component = fixture.componentInstance;
    const emitted: string[] = [];
    component.topicSelected.subscribe((topic) => emitted.push(topic));

    component.selectTopic("device");

    expect(emitted).toEqual(["device"]);
    expect(component.selectedTopic()).toBe("device");
  });

  it("shows the message count, last payload preview, and time-ago for a leaf", async () => {
    const msg = message({
      payload: [123, 34, 111, 107, 34, 58, 116, 114, 117, 101, 125], // {"ok":true}
      receivedAt: Date.now() - 12_000,
    });
    const { fixture } = await setup(new Map([["device", [message(), msg]]]));

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("2");
    expect(text).toContain('{"ok":true}');
    expect(text).toContain("12s ago");
  });

  it("does not flash a topic the first time it's populated", () => {
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    topics$.next(new Map([["device", [message()]]]));
    fixture.detectChanges();

    expect(component.isFlashing("device")).toBe(false);
  });

  it("flashes a leaf whose last message just changed, then stops after the flash duration", () => {
    vi.useFakeTimers();
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    const first = message();
    topics$.next(new Map([["device", [first]]]));
    fixture.detectChanges();

    const second = message();
    topics$.next(new Map([["device", [first, second]]]));
    fixture.detectChanges();

    expect(component.isFlashing("device")).toBe(true);

    vi.advanceTimersByTime(5000);

    expect(component.isFlashing("device")).toBe(false);
  });

  it("restarts the flash if another update arrives while still flashing", () => {
    vi.useFakeTimers();
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    const first = message();
    topics$.next(new Map([["device", [first]]]));
    fixture.detectChanges();

    const second = message();
    topics$.next(new Map([["device", [first, second]]]));
    fixture.detectChanges();

    expect(component.isFlashing("device")).toBe(true);

    // A third message arrives partway through the first flash, while still flashing.
    vi.advanceTimersByTime(200);
    const third = message();
    topics$.next(new Map([["device", [first, second, third]]]));
    fixture.detectChanges();

    // The class must genuinely toggle off (even briefly) so the CSS
    // animation restarts, rather than staying a no-op "true".
    expect(component.isFlashing("device")).toBe(false);

    vi.advanceTimersByTime(0);
    expect(component.isFlashing("device")).toBe(true);

    // The clear timer should have been reset to the full duration from the
    // restart point, not the original (now-elapsed) deadline.
    vi.advanceTimersByTime(399);
    expect(component.isFlashing("device")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(component.isFlashing("device")).toBe(false);
  });

  it("flips the toggle label immediately on click, even with an empty tree", () => {
    const { fixture } = setupStreaming();
    const component = fixture.componentInstance;

    expect(component.allExpanded()).toBe(false);
    let text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Expand all");

    component.toggleExpandAll();
    fixture.detectChanges();

    expect(component.allExpanded()).toBe(true);
    text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Collapse all");
  });

  it("expands topics that arrive after 'expand all' was clicked on an empty tree", () => {
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    component.toggleExpandAll();
    fixture.detectChanges();

    topics$.next(new Map([["sensors/temp", [message()]]]));
    fixture.detectChanges();

    expect(component.isExpanded("sensors")).toBe(true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("temp");
  });

  it("expands a new folder that arrives after 'expand all', without collapsing existing ones", () => {
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    topics$.next(new Map([["sensors/temp", [message()]]]));
    fixture.detectChanges();
    component.toggleExpandAll();
    fixture.detectChanges();
    expect(component.isExpanded("sensors")).toBe(true);

    topics$.next(
      new Map([
        ["sensors/temp", [message()]],
        ["device/battery", [message()]],
      ]),
    );
    fixture.detectChanges();

    expect(component.isExpanded("sensors")).toBe(true);
    expect(component.isExpanded("device")).toBe(true);
  });

  it("leaves a manually-collapsed folder collapsed even while 'expand all' is still in effect", () => {
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    topics$.next(
      new Map([
        ["sensors/temp", [message()]],
        ["device/battery", [message()]],
      ]),
    );
    fixture.detectChanges();
    component.toggleExpandAll();
    fixture.detectChanges();

    component.toggleFolder("sensors");
    fixture.detectChanges();
    expect(component.isExpanded("sensors")).toBe(false);

    topics$.next(
      new Map([
        ["sensors/temp", [message()]],
        ["device/battery", [message()]],
        ["other/leaf", [message()]],
      ]),
    );
    fixture.detectChanges();

    expect(component.isExpanded("sensors")).toBe(false);
    expect(component.isExpanded("device")).toBe(true);
    expect(component.isExpanded("other")).toBe(true);
  });

  it("only flashes the topic that actually received a new message", () => {
    const { fixture, topics$ } = setupStreaming();
    const component = fixture.componentInstance;

    const shared = message();
    topics$.next(
      new Map([
        ["device", [shared]],
        ["other", [shared]],
      ]),
    );
    fixture.detectChanges();

    topics$.next(
      new Map([
        ["device", [shared, message()]],
        ["other", [shared]],
      ]),
    );
    fixture.detectChanges();

    expect(component.isFlashing("device")).toBe(true);
    expect(component.isFlashing("other")).toBe(false);
  });
});
