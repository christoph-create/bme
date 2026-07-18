import { TestBed } from "@angular/core/testing";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../core/services/message-store.service";
import { MessageStream } from "./message-stream";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function encode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

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
  messagesByTopic: Record<string, readonly StoredMessage[]>,
) {
  const messagesFor = vi
    .fn()
    .mockImplementation((_connectionId: string, topic: string) =>
      of(messagesByTopic[topic] ?? []),
    );

  TestBed.configureTestingModule({
    imports: [MessageStream],
    providers: [{ provide: MessageStoreService, useValue: { messagesFor } }],
  });

  const fixture = TestBed.createComponent(MessageStream);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, messagesFor };
}

async function selectTopic(
  fixture: Awaited<ReturnType<typeof setup>>["fixture"],
  topic: string,
) {
  fixture.componentRef.setInput("topic", topic);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe("MessageStream", () => {
  it("prompts to select a topic when none is selected", async () => {
    const { fixture } = await setup({});

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Select a topic");
  });

  it("shows the topic path and message count once a topic is selected", async () => {
    const { fixture } = await setup({ device: [message(), message()] });
    await selectTopic(fixture, "device");

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("device");
    expect(text).toContain("2 messages in this session");
  });

  it("uses singular 'message' for exactly one message", async () => {
    const { fixture } = await setup({ device: [message()] });
    await selectTopic(fixture, "device");

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("1 message in this session");
  });

  it("shows a placeholder when the selected topic has no messages yet", async () => {
    const { fixture } = await setup({});
    await selectTopic(fixture, "device");

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No messages yet on this topic");
  });

  it("renders messages newest-first with QoS and payload", async () => {
    const first = message({
      payload: [111, 108, 100], // "old"
      receivedAt: Date.now() - 60_000,
    });
    const second = message({
      payload: [110, 101, 119], // "new"
      qos: "ExactlyOnce",
      receivedAt: Date.now() - 1_000,
    });
    const { fixture } = await setup({ device: [first, second] });
    await selectTopic(fixture, "device");

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll(
      ".message-card",
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("new");
    expect(cards[0].textContent).toContain("QoS 2");
    expect(cards[1].textContent).toContain("old");
  });

  it("shows a Retained badge only for retained messages", async () => {
    const { fixture } = await setup({ device: [message({ retain: true })] });
    await selectTopic(fixture, "device");

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Retained");
  });

  it("does not show a Retained badge for non-retained messages", async () => {
    const { fixture } = await setup({ device: [message({ retain: false })] });
    await selectTopic(fixture, "device");

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("Retained");
  });

  it("pretty-prints JSON payloads by default", async () => {
    const payload = encode('{"data1":"data","data2":"data"}');
    const { fixture } = await setup({ device: [message({ payload })] });
    await selectTopic(fixture, "device");

    const body = (fixture.nativeElement as HTMLElement).querySelector(
      ".payload",
    );
    expect(body?.textContent).toBe(
      '{\n  "data1": "data",\n  "data2": "data"\n}',
    );
  });

  it("shows the raw compact JSON after toggling to Raw, for every card", async () => {
    const payload = encode('{"data1":"data","data2":"data"}');
    const { fixture } = await setup({ device: [message({ payload })] });
    await selectTopic(fixture, "device");

    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector(".toggle-link") as HTMLElement;
    expect(toggle.textContent?.trim()).toBe("Raw");

    toggle.click();
    fixture.detectChanges();

    expect(element.querySelector(".payload")?.textContent).toBe(
      '{"data1":"data","data2":"data"}',
    );
    expect(toggle.textContent?.trim()).toBe("Pretty JSON");

    toggle.click();
    fixture.detectChanges();

    expect(element.querySelector(".payload")?.textContent).toBe(
      '{\n  "data1": "data",\n  "data2": "data"\n}',
    );
  });

  it("switches to the newly selected topic's messages", async () => {
    const { fixture, messagesFor } = await setup({
      device: [message({ payload: [100] })],
      "other/topic": [message({ payload: [200] })],
    });
    await selectTopic(fixture, "device");

    expect(messagesFor).toHaveBeenCalledWith(CONNECTION_ID, "device");

    await selectTopic(fixture, "other/topic");

    expect(messagesFor).toHaveBeenCalledWith(CONNECTION_ID, "other/topic");
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("other/topic");
  });

  describe("virtualization", () => {
    function manyMessages(count: number): StoredMessage[] {
      return Array.from({ length: count }, (_, i) =>
        message({
          payload: encode(`msg-${i}`),
          receivedAt: Date.now() - (count - i) * 1000,
        }),
      );
    }

    it("keeps the DOM node count far below the message count for a long history", async () => {
      const { fixture } = await setup({ device: manyMessages(500) });
      await selectTopic(fixture, "device");

      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("500 messages in this session");

      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll(
        ".message-card",
      );
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThan(50);
    });

    it("renders a different slice of messages after scrolling", async () => {
      const { fixture } = await setup({ device: manyMessages(500) });
      await selectTopic(fixture, "device");

      const element = fixture.nativeElement as HTMLElement;
      // Newest-first: the most recent message starts out on screen.
      expect(element.textContent).toContain("msg-499");

      const list = element.querySelector(".message-list") as HTMLElement;
      list.scrollTop = 5000;
      list.dispatchEvent(new Event("scroll"));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(element.textContent).not.toContain("msg-499");
    });
  });
});
