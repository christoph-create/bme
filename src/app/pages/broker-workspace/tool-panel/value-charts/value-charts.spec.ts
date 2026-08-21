import { TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { ValueChartsService } from "../../../../core/services/value-charts.service";
import { ValueCharts } from "./value-charts";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const TOPIC = "sensors/kitchen";

function message(text: string, receivedAt = 1000): StoredMessage {
  const payload = Array.from(new TextEncoder().encode(text));
  return {
    payload,
    payloadLen: payload.length,
    qos: "AtMostOnce",
    retain: false,
    receivedAt,
  };
}

async function setup(
  messagesByTopic: Record<string, readonly StoredMessage[]> = {},
) {
  const subjects = new Map<string, BehaviorSubject<readonly StoredMessage[]>>();
  const messagesFor = vi.fn().mockImplementation((_id: string, topic: string) => {
    let subject = subjects.get(topic);
    if (!subject) {
      subject = new BehaviorSubject<readonly StoredMessage[]>(
        messagesByTopic[topic] ?? [],
      );
      subjects.set(topic, subject);
    }
    return subject;
  });

  TestBed.configureTestingModule({
    imports: [ValueCharts],
    providers: [{ provide: MessageStoreService, useValue: { messagesFor } }],
  });

  const charts = TestBed.inject(ValueChartsService);
  const fixture = TestBed.createComponent(ValueCharts);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function selectTopic(topic: string | null): Promise<void> {
    fixture.componentRef.setInput("selectedTopic", topic);
    await settle();
  }

  /** Pushes a new history for a topic the way an arriving message would. */
  async function push(
    topic: string,
    messages: readonly StoredMessage[],
  ): Promise<void> {
    subjects.get(topic)?.next(messages);
    await settle();
  }

  await settle();

  const text = () => fixture.nativeElement.textContent as string;
  const addButton = () =>
    fixture.nativeElement.querySelector(".add-chart") as HTMLButtonElement;
  const options = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll(".picker-option"),
    ) as HTMLButtonElement[];
  const optionRows = () =>
    options().map((option) => ({
      field: option.querySelector(".picker-field")?.textContent,
      value: option.querySelector(".picker-value")?.textContent,
      picked: option.classList.contains("picked"),
    }));
  const cards = () =>
    fixture.nativeElement.querySelectorAll("app-value-chart-card").length;
  async function openPicker(): Promise<void> {
    addButton().click();
    await settle();
  }

  return {
    fixture,
    charts,
    settle,
    selectTopic,
    push,
    text,
    addButton,
    options,
    optionRows,
    cards,
    openPicker,
  };
}

describe("ValueCharts", () => {
  it("explains what to do when nothing is charted", async () => {
    const { text, cards } = await setup();

    expect(cards()).toBe(0);
    expect(text()).toContain("No charts yet");
  });

  it("disables adding until a topic is selected", async () => {
    const { addButton, text } = await setup();

    expect(addButton().disabled).toBe(true);
    expect(text()).toContain("Select a topic to chart a value");
  });

  it("says the topic has no messages rather than blaming its payload", async () => {
    const { selectTopic, addButton, text } = await setup();

    await selectTopic(TOPIC);

    expect(addButton().disabled).toBe(true);
    expect(text()).toContain(`No messages on ${TOPIC} yet`);
  });

  it("disables adding for a topic that never carries a number", async () => {
    const { selectTopic, addButton, text } = await setup({
      [TOPIC]: [message('{"state":"on"}')],
    });

    await selectTopic(TOPIC);

    expect(addButton().disabled).toBe(true);
    expect(text()).toContain("No numeric values in this topic's messages");
  });

  it("names the selected topic on the add button", async () => {
    const { selectTopic, addButton } = await setup({
      [TOPIC]: [message('{"temp":21}')],
    });

    await selectTopic(TOPIC);

    expect(addButton().disabled).toBe(false);
    expect(addButton().textContent).toContain("Add chart from kitchen");
  });

  describe("the field list", () => {
    it("lists discovered fields with their current values", async () => {
      const { selectTopic, openPicker, optionRows } = await setup({
        [TOPIC]: [message('{"temp":21,"battery":{"level":88}}')],
      });
      await selectTopic(TOPIC);

      await openPicker();

      expect(optionRows()).toEqual([
        { field: "temp", value: "21", picked: false },
        { field: "battery.level", value: "88", picked: false },
      ]);
    });

    it("unions fields across payload shapes, not just the newest message", async () => {
      const { selectTopic, openPicker, optionRows } = await setup({
        [TOPIC]: [
          message('{"temp":21,"battery":{"level":88}}', 1000),
          message('{"temp":22}', 2000),
        ],
      });
      await selectTopic(TOPIC);

      await openPicker();

      expect(optionRows().map((r) => r.field)).toEqual([
        "temp",
        "battery.level",
      ]);
    });

    it("shows each field's most recent value", async () => {
      const { selectTopic, openPicker, optionRows } = await setup({
        [TOPIC]: [
          message('{"temp":21,"battery":{"level":88}}', 1000),
          message('{"temp":22}', 2000),
        ],
      });
      await selectTopic(TOPIC);

      await openPicker();

      expect(optionRows()).toEqual([
        { field: "temp", value: "22", picked: false },
        { field: "battery.level", value: "88", picked: false },
      ]);
    });

    it("keeps updating while the picker is open", async () => {
      const { selectTopic, openPicker, push, optionRows } = await setup({
        [TOPIC]: [message('{"temp":21}', 1000)],
      });
      await selectTopic(TOPIC);
      await openPicker();
      expect(optionRows()).toEqual([
        { field: "temp", value: "21", picked: false },
      ]);

      await push(TOPIC, [
        message('{"temp":21}', 1000),
        message('{"temp":25,"humidity":40}', 2000),
      ]);

      expect(optionRows()).toEqual([
        { field: "temp", value: "25", picked: false },
        { field: "humidity", value: "40", picked: false },
      ]);
    });

    it("offers a field that only ever appeared once", async () => {
      const { selectTopic, openPicker, optionRows } = await setup({
        [TOPIC]: [
          message('{"rssi":-70}', 1000),
          ...Array.from({ length: 10 }, (_, i) =>
            message(`{"temp":${20 + i}}`, 2000 + i),
          ),
        ],
      });
      await selectTopic(TOPIC);

      await openPicker();

      expect(optionRows().map((r) => r.field)).toEqual(["rssi", "temp"]);
    });
  });

  describe("the picker", () => {
    it("adds a chart for the picked field", async () => {
      const { selectTopic, openPicker, options, cards, charts } = await setup({
        [TOPIC]: [message('{"temp":21,"humidity":40}')],
      });
      await selectTopic(TOPIC);
      await openPicker();

      options()[1].click();
      await new Promise((r) => setTimeout(r, 0));

      expect(charts.charts()[0]).toMatchObject({
        topic: TOPIC,
        fieldPath: ["humidity"],
        label: "humidity",
      });
      expect(cards()).toBe(1);
    });

    it("stays open so several values can be picked in one go", async () => {
      const { selectTopic, openPicker, options, settle, cards, optionRows } =
        await setup({
          [TOPIC]: [message('{"temp":21,"humidity":40,"rssi":-70}')],
        });
      await selectTopic(TOPIC);
      await openPicker();

      options()[0].click();
      await settle();
      options()[2].click();
      await settle();

      expect(cards()).toBe(2);
      expect(optionRows().map((r) => r.picked)).toEqual([true, false, true]);
    });

    it("un-picks a field on a second click", async () => {
      const { selectTopic, openPicker, options, settle, cards } = await setup({
        [TOPIC]: [message('{"temp":21}')],
      });
      await selectTopic(TOPIC);
      await openPicker();

      options()[0].click();
      await settle();
      options()[0].click();
      await settle();

      expect(cards()).toBe(0);
    });

    it("closes on Done", async () => {
      const { fixture, selectTopic, openPicker, options, settle } = await setup({
        [TOPIC]: [message('{"temp":21}')],
      });
      await selectTopic(TOPIC);
      await openPicker();

      (
        fixture.nativeElement.querySelector(".picker-close") as HTMLButtonElement
      ).click();
      await settle();

      expect(options()).toHaveLength(0);
    });

    it("closes when a different topic is selected", async () => {
      const { selectTopic, openPicker, options } = await setup({
        [TOPIC]: [message('{"temp":21}')],
        "sensors/hall": [message('{"temp":18}')],
      });
      await selectTopic(TOPIC);
      await openPicker();

      await selectTopic("sensors/hall");

      expect(options()).toHaveLength(0);
    });
  });

  it("keeps its charts when the selected topic changes", async () => {
    const { selectTopic, openPicker, options, settle, cards } = await setup({
      [TOPIC]: [message('{"temp":21}')],
      "sensors/hall": [message('{"temp":18}')],
    });
    await selectTopic(TOPIC);
    await openPicker();
    options()[0].click();
    await settle();

    await selectTopic("sensors/hall");

    expect(cards()).toBe(1);
  });

  it("lays the cards out in two columns only when wide", async () => {
    const { fixture, selectTopic, openPicker, options, settle } = await setup({
      [TOPIC]: [message('{"temp":21}')],
    });
    await selectTopic(TOPIC);
    await openPicker();
    options()[0].click();
    await settle();

    const stack = () => fixture.nativeElement.querySelector(".card-stack");
    expect(stack().classList.contains("wide")).toBe(false);

    fixture.componentRef.setInput("wide", true);
    await settle();

    expect(stack().classList.contains("wide")).toBe(true);
  });
});
