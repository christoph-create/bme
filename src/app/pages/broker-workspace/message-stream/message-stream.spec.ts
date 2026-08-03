import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { MessageDraft } from "../../../core/models/message-draft.model";
import { StoredMessage } from "../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../core/services/message-store.service";
import { MqttService } from "../../../core/services/mqtt.service";
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
  options: {
    publish?: ReturnType<typeof vi.fn>;
    retainedTopics?: ReadonlySet<string>;
  } = {},
) {
  const messagesFor = vi
    .fn()
    .mockImplementation((_connectionId: string, topic: string) =>
      of(messagesByTopic[topic] ?? []),
    );
  const publish = options.publish ?? vi.fn().mockResolvedValue(undefined);
  const retainedTopicsFor = vi
    .fn()
    .mockReturnValue(of(options.retainedTopics ?? new Set<string>()));
  const forgetRetained = vi.fn();

  TestBed.configureTestingModule({
    imports: [MessageStream],
    providers: [
      {
        provide: MessageStoreService,
        useValue: { messagesFor, retainedTopicsFor, forgetRetained },
      },
      { provide: MqttService, useValue: { publish } },
    ],
  });

  const fixture = TestBed.createComponent(MessageStream);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, messagesFor, publish, forgetRetained };
}

/** Like `setup`, but the store's history is a live subject, so a test can
 * push new messages the way an actual broker would. */
async function setupStreaming(initial: readonly StoredMessage[] = []) {
  const messages$ = new BehaviorSubject<readonly StoredMessage[]>(initial);
  const messagesFor = vi.fn().mockReturnValue(messages$);
  const clearTopic = vi.fn().mockImplementation(() => messages$.next([]));
  const retainedTopicsFor = vi.fn().mockReturnValue(of(new Set<string>()));

  TestBed.configureTestingModule({
    imports: [MessageStream],
    providers: [
      {
        provide: MessageStoreService,
        useValue: {
          messagesFor,
          clearTopic,
          retainedTopicsFor,
          forgetRetained: vi.fn(),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(MessageStream);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, messages$, clearTopic };
}

/** Picks a per-message control off the first (newest) card. */
function cardAction(element: HTMLElement, label: string): HTMLElement {
  const match = [...element.querySelectorAll(".card-action")].find(
    (action) => action.textContent?.trim() === label,
  );
  if (match === undefined) {
    throw new Error(`no card action labelled "${label}"`);
  }
  return match as HTMLElement;
}

/** Picks a header control by its label - the header holds several, and which
 * one is first is a layout detail no test should depend on. */
function toggleLink(element: HTMLElement, label: string): HTMLElement {
  const match = [...element.querySelectorAll(".toggle-link")].find(
    (link) => link.textContent?.trim() === label,
  );
  if (match === undefined) {
    throw new Error(`no header control labelled "${label}"`);
  }
  return match as HTMLElement;
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
    const toggle = toggleLink(element, "Raw");
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

  describe("pause", () => {
    it("freezes the visible list while messages keep arriving", async () => {
      const { fixture, messages$ } = await setupStreaming([
        message({ payload: encode("first") }),
      ]);
      await selectTopic(fixture, "device");
      const element = fixture.nativeElement as HTMLElement;

      fixture.componentInstance.togglePause();
      messages$.next([
        message({ payload: encode("first") }),
        message({ payload: encode("second") }),
      ]);
      fixture.detectChanges();

      expect(element.textContent).toContain("first");
      expect(element.textContent).not.toContain("second");
    });

    it("counts what arrived while paused", async () => {
      const { fixture, messages$ } = await setupStreaming([message()]);
      await selectTopic(fixture, "device");
      const component = fixture.componentInstance;

      component.togglePause();
      messages$.next([message(), message()]);
      messages$.next([message(), message(), message()]);
      fixture.detectChanges();

      expect(component.pendingCount()).toBe(2);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        "Paused · 2 new",
      );
    });

    it("catches up on resume", async () => {
      const { fixture, messages$ } = await setupStreaming([
        message({ payload: encode("first") }),
      ]);
      await selectTopic(fixture, "device");
      const component = fixture.componentInstance;
      const element = fixture.nativeElement as HTMLElement;

      component.togglePause();
      messages$.next([
        message({ payload: encode("first") }),
        message({ payload: encode("second") }),
      ]);
      fixture.detectChanges();

      component.togglePause();
      fixture.detectChanges();

      expect(element.textContent).toContain("second");
      expect(component.pendingCount()).toBe(0);
      expect(component.paused()).toBe(false);
    });

    it("does not carry a pause over to a newly selected topic", async () => {
      const { fixture } = await setupStreaming([message()]);
      await selectTopic(fixture, "device");
      const component = fixture.componentInstance;

      component.togglePause();
      expect(component.paused()).toBe(true);

      await selectTopic(fixture, "other");

      expect(component.paused()).toBe(false);
      expect(component.pendingCount()).toBe(0);
    });
  });

  describe("resend", () => {
    it("emits a draft carrying the message's topic, payload, QoS and retain", async () => {
      const { fixture } = await setup({
        device: [
          message({
            payload: encode('{"on":true}'),
            qos: "ExactlyOnce",
            retain: true,
          }),
        ],
      });
      await selectTopic(fixture, "device");

      const emitted: MessageDraft[] = [];
      fixture.componentInstance.resendRequested.subscribe((draft) =>
        emitted.push(draft),
      );
      cardAction(fixture.nativeElement as HTMLElement, "Resend").click();

      expect(emitted).toEqual([
        {
          topic: "device",
          payload: '{"on":true}',
          format: "json",
          qos: "ExactlyOnce",
          retain: true,
        },
      ]);
    });

    it("emits again when the same message is resent twice", async () => {
      const { fixture } = await setup({
        device: [message({ payload: encode("ON") })],
      });
      await selectTopic(fixture, "device");

      const emitted: MessageDraft[] = [];
      fixture.componentInstance.resendRequested.subscribe((draft) =>
        emitted.push(draft),
      );
      const action = cardAction(fixture.nativeElement as HTMLElement, "Resend");
      action.click();
      action.click();

      expect(emitted).toHaveLength(2);
    });

    it("disables resend for a binary payload instead of emitting its label", async () => {
      const binary = Array.from({ length: 40 }, (_, i) => 0x80 + (i % 0x40));
      const { fixture } = await setup({ device: [message({ payload: binary })] });
      await selectTopic(fixture, "device");

      const emitted: MessageDraft[] = [];
      fixture.componentInstance.resendRequested.subscribe((draft) =>
        emitted.push(draft),
      );
      const action = cardAction(fixture.nativeElement as HTMLElement, "Resend");
      expect(action.classList).toContain("disabled");

      action.click();
      expect(emitted).toEqual([]);
    });
  });

  describe("copy", () => {
    it("copies the decoded payload and confirms it", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      const { fixture } = await setup({
        device: [message({ payload: encode('{"on":true}') })],
      });
      await selectTopic(fixture, "device");

      cardAction(fixture.nativeElement as HTMLElement, "Copy").click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(writeText).toHaveBeenCalledWith('{"on":true}');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        "Copied",
      );
      vi.unstubAllGlobals();
    });

    it("reports a clipboard rejection instead of throwing", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      const { fixture } = await setup({
        device: [message({ payload: encode("ON") })],
      });
      await selectTopic(fixture, "device");

      cardAction(fixture.nativeElement as HTMLElement, "Copy").click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        "Copy failed",
      );
      vi.unstubAllGlobals();
    });
  });

  describe("clear retained", () => {
    async function withTopic(publish?: ReturnType<typeof vi.fn>) {
      const result = await setup(
        { device: [message({ retain: true })] },
        publish === undefined ? {} : { publish },
      );
      result.fixture.componentRef.setInput("connected", true);
      await selectTopic(result.fixture, "device");
      return result;
    }

    it("asks for confirmation before touching the broker", async () => {
      const { fixture, publish } = await withTopic();

      toggleLink(fixture.nativeElement as HTMLElement, "Clear retained").click();
      fixture.detectChanges();

      expect(publish).not.toHaveBeenCalled();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          "app-confirm-dialog",
        ),
      ).not.toBeNull();
    });

    it("publishes an empty retained message on confirm", async () => {
      const { fixture, publish } = await withTopic();
      const component = fixture.componentInstance;

      component.askClearRetained();
      await component.clearRetained();

      expect(publish).toHaveBeenCalledWith(
        CONNECTION_ID,
        "device",
        new Uint8Array(0),
        "AtMostOnce",
        true,
      );
      expect(component.confirmingClearRetained()).toBe(false);
    });

    it("publishes nothing when the confirmation is cancelled", async () => {
      const { fixture, publish } = await withTopic();
      const component = fixture.componentInstance;

      component.askClearRetained();
      component.cancelClearRetained();
      fixture.detectChanges();

      expect(publish).not.toHaveBeenCalled();
      expect(component.confirmingClearRetained()).toBe(false);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          "app-confirm-dialog",
        ),
      ).toBeNull();
    });

    it("surfaces a publish failure instead of silently doing nothing", async () => {
      const publish = vi.fn().mockRejectedValue(new Error("Not connected"));
      const { fixture } = await withTopic(publish);
      const component = fixture.componentInstance;

      component.askClearRetained();
      await component.clearRetained();
      fixture.detectChanges();

      expect(component.clearRetainedError()).toBe("Not connected");
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        "Not connected",
      );
    });

    it("badges the header when the topic is known to hold a retained message", async () => {
      const { fixture } = await setup(
        { device: [message()] },
        { retainedTopics: new Set(["device"]) },
      );
      await selectTopic(fixture, "device");

      expect(fixture.componentInstance.topicHasRetained()).toBe(true);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(".retain-badge"),
      ).not.toBeNull();
    });

    it("does not badge a topic that is only known to have had live traffic", async () => {
      const { fixture } = await setup(
        { device: [message()], other: [message()] },
        { retainedTopics: new Set(["other"]) },
      );
      await selectTopic(fixture, "device");

      expect(fixture.componentInstance.topicHasRetained()).toBe(false);
    });

    it("forgets the retained mark after clearing it on the broker", async () => {
      const { fixture, forgetRetained } = await setup(
        { device: [message({ retain: true })] },
        { retainedTopics: new Set(["device"]) },
      );
      fixture.componentRef.setInput("connected", true);
      await selectTopic(fixture, "device");

      await fixture.componentInstance.clearRetained();

      expect(forgetRetained).toHaveBeenCalledWith(CONNECTION_ID, "device");
    });

    it("keeps the retained mark when the publish failed", async () => {
      const publish = vi.fn().mockRejectedValue(new Error("Not connected"));
      const { fixture, forgetRetained } = await setup(
        { device: [message({ retain: true })] },
        { publish, retainedTopics: new Set(["device"]) },
      );
      fixture.componentRef.setInput("connected", true);
      await selectTopic(fixture, "device");

      await fixture.componentInstance.clearRetained();

      expect(forgetRetained).not.toHaveBeenCalled();
    });

    it("does not offer the action while disconnected, since the backend drops the publish", async () => {
      const { fixture, publish } = await setup({
        device: [message({ retain: true })],
      });
      fixture.componentRef.setInput("connected", false);
      await selectTopic(fixture, "device");
      const component = fixture.componentInstance;

      toggleLink(fixture.nativeElement as HTMLElement, "Clear retained").click();
      fixture.detectChanges();

      expect(component.confirmingClearRetained()).toBe(false);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("clears the selected topic from the store and empties the panel", async () => {
      const { fixture, clearTopic } = await setupStreaming([
        message({ payload: encode("first") }),
      ]);
      await selectTopic(fixture, "device");
      const element = fixture.nativeElement as HTMLElement;
      expect(element.textContent).toContain("first");

      fixture.componentInstance.clearMessages();
      fixture.detectChanges();

      expect(clearTopic).toHaveBeenCalledWith(CONNECTION_ID, "device");
      expect(element.textContent).not.toContain("first");
      expect(element.textContent).toContain("No messages yet on this topic");
    });

    it("does nothing when no topic is selected", async () => {
      const { fixture, clearTopic } = await setupStreaming();

      fixture.componentInstance.clearMessages();

      expect(clearTopic).not.toHaveBeenCalled();
    });

    it("drops any paused backlog, so resuming does not resurrect cleared messages", async () => {
      const { fixture, messages$ } = await setupStreaming([
        message({ payload: encode("first") }),
      ]);
      await selectTopic(fixture, "device");
      const component = fixture.componentInstance;

      component.togglePause();
      messages$.next([
        message({ payload: encode("first") }),
        message({ payload: encode("second") }),
      ]);
      component.clearMessages();
      component.togglePause();
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).not.toContain("second");
      expect(text).toContain("No messages yet on this topic");
    });
  });
});
