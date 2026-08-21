import { TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { ChartSpec } from "../../../../core/services/value-charts.service";
import { ValueChartCard } from "./value-chart-card";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

const SPEC: ChartSpec = {
  id: "chart-1",
  connectionId: CONNECTION_ID,
  topic: "sensors/kitchen",
  fieldPath: ["temp"],
  label: "temp",
};

function message(text: string, receivedAt: number): StoredMessage {
  const payload = Array.from(new TextEncoder().encode(text));
  return {
    payload,
    payloadLen: payload.length,
    qos: "AtMostOnce",
    retain: false,
    receivedAt,
  };
}

async function setup(initial: readonly StoredMessage[] = [], spec = SPEC) {
  const messages$ = new BehaviorSubject<readonly StoredMessage[]>(initial);
  const messagesFor = vi.fn().mockReturnValue(messages$);

  TestBed.configureTestingModule({
    imports: [ValueChartCard],
    providers: [{ provide: MessageStoreService, useValue: { messagesFor } }],
  });

  const fixture = TestBed.createComponent(ValueChartCard);
  fixture.componentRef.setInput("spec", spec);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const text = () => fixture.nativeElement.textContent as string;
  const polyline = () =>
    fixture.nativeElement.querySelector("polyline") as SVGPolylineElement | null;
  const pointCount = () =>
    polyline()?.getAttribute("points")?.split(" ").length ?? 0;

  async function push(messages: readonly StoredMessage[]): Promise<void> {
    messages$.next(messages);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  return { fixture, messages$, messagesFor, push, text, polyline, pointCount };
}

describe("ValueChartCard", () => {
  it("subscribes to its own topic, not the selected one", async () => {
    const { messagesFor } = await setup();

    expect(messagesFor).toHaveBeenCalledWith(CONNECTION_ID, "sensors/kitchen");
  });

  it("waits for messages when the topic has none", async () => {
    const { text, polyline } = await setup();

    expect(text()).toContain("Waiting for messages");
    expect(polyline()).toBeNull();
  });

  it("plots a point per message carrying the field", async () => {
    const { pointCount } = await setup([
      message('{"temp":20}', 1000),
      message('{"temp":21}', 2000),
      message('{"temp":22}', 3000),
    ]);

    expect(pointCount()).toBe(3);
  });

  it("shows the newest reading as the headline value", async () => {
    const { text } = await setup([
      message('{"temp":20}', 1000),
      message('{"temp":23.5}', 2000),
    ]);

    expect(text()).toContain("23.5");
  });

  it("redraws when a new message arrives", async () => {
    const { push, pointCount } = await setup([message('{"temp":20}', 1000)]);

    await push([message('{"temp":20}', 1000), message('{"temp":21}', 2000)]);

    expect(pointCount()).toBe(2);
  });

  it("reads a bare numeric payload through an empty field path", async () => {
    const { text } = await setup([message("23.5", 1000), message("24", 2000)], {
      ...SPEC,
      fieldPath: [],
      label: "kitchen",
    });

    expect(text()).toContain("24");
  });

  it("reports a field that stopped appearing rather than plotting zeros", async () => {
    const { text, polyline } = await setup([message('{"other":1}', 1000)]);

    expect(text()).toContain("No recent value for temp");
    expect(polyline()).toBeNull();
  });

  it("empties when the topic's history is cleared, then recovers", async () => {
    const { push, text, pointCount } = await setup([
      message('{"temp":20}', 1000),
      message('{"temp":21}', 2000),
    ]);

    await push([]);
    expect(text()).toContain("Waiting for messages");

    await push([message('{"temp":30}', 3000), message('{"temp":31}', 4000)]);
    expect(pointCount()).toBe(2);
  });

  it("stops listening to the store once destroyed", async () => {
    const { fixture, messages$ } = await setup([message('{"temp":20}', 1000)]);
    expect(messages$.observed).toBe(true);

    fixture.destroy();

    expect(messages$.observed).toBe(false);
  });

  describe("paused", () => {
    it("holds the chart still while messages keep arriving", async () => {
      const { fixture, push, pointCount } = await setup([
        message('{"temp":20}', 1000),
        message('{"temp":21}', 2000),
      ]);

      fixture.componentRef.setInput("paused", true);
      fixture.detectChanges();
      await push([
        message('{"temp":20}', 1000),
        message('{"temp":21}', 2000),
        message('{"temp":22}', 3000),
      ]);

      expect(pointCount()).toBe(2);
    });

    it("catches up on everything that arrived once resumed", async () => {
      const { fixture, push, pointCount, text } = await setup([
        message('{"temp":20}', 1000),
      ]);
      fixture.componentRef.setInput("paused", true);
      fixture.detectChanges();
      await push([
        message('{"temp":20}', 1000),
        message('{"temp":21}', 2000),
        message('{"temp":25}', 3000),
      ]);

      fixture.componentRef.setInput("paused", false);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(pointCount()).toBe(3);
      expect(text()).toContain("25");
    });

    it("does not rewind when resumed with nothing buffered", async () => {
      const { fixture, pointCount } = await setup([
        message('{"temp":20}', 1000),
        message('{"temp":21}', 2000),
      ]);

      fixture.componentRef.setInput("paused", true);
      fixture.detectChanges();
      fixture.componentRef.setInput("paused", false);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(pointCount()).toBe(2);
    });
  });

  it("emits the chart id when removed", async () => {
    const { fixture } = await setup();
    const removed: string[] = [];
    fixture.componentInstance.removeRequested.subscribe((id: string) =>
      removed.push(id),
    );

    fixture.nativeElement.querySelector(".card-remove").click();

    expect(removed).toEqual(["chart-1"]);
  });
});
