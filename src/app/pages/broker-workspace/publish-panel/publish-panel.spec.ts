import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MqttService } from "../../../core/services/mqtt.service";
import { PublishPanel } from "./publish-panel";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function setup(publish = vi.fn().mockResolvedValue(undefined)) {
  const mqttService = { publish };

  TestBed.configureTestingModule({
    imports: [PublishPanel],
    providers: [{ provide: MqttService, useValue: mqttService }],
  });

  const fixture = TestBed.createComponent(PublishPanel);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, mqttService, publish };
}

function clickSegment(
  fixture: Awaited<ReturnType<typeof setup>>["fixture"],
  selector: string,
  label: string,
): void {
  const options = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector),
  );
  const match = options.find((el) => el.textContent?.trim() === label);
  if (!match) {
    throw new Error(`no ${selector} option labelled "${label}"`);
  }
  (match as HTMLElement).click();
  fixture.detectChanges();
}

describe("PublishPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("pre-fills the topic field from the topic input", async () => {
    const { fixture } = await setup();

    fixture.componentRef.setInput("topic", "sensors/zone-a");
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.topic.value).toBe(
      "sensors/zone-a",
    );
  });

  it("updates the topic field again when the topic input changes to a different topic", async () => {
    const { fixture } = await setup();

    fixture.componentRef.setInput("topic", "sensors/zone-a");
    fixture.detectChanges();
    fixture.componentRef.setInput("topic", "sensors/zone-b");
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.topic.value).toBe(
      "sensors/zone-b",
    );
  });

  it("does not publish when the topic field is empty", async () => {
    const { fixture, publish } = await setup();
    fixture.componentInstance.form.controls.payload.setValue('{"a":1}');

    await fixture.componentInstance.publish();

    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish when the payload field is empty", async () => {
    const { fixture, publish } = await setup();
    fixture.componentInstance.form.controls.topic.setValue("sensors/zone-a");

    await fixture.componentInstance.publish();

    expect(publish).not.toHaveBeenCalled();
  });

  it("compacts valid JSON before publishing in JSON format (the default)", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue('{"a": 1,   "b": 2}');

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/zone-a",
      encode('{"a":1,"b":2}'),
      "AtMostOnce",
      false,
    );
  });

  it("sends invalid JSON as raw text rather than blocking, in JSON format", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("not valid json");

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/zone-a",
      encode("not valid json"),
      "AtMostOnce",
      false,
    );
  });

  it("sends the payload verbatim, untouched, in RAW format", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue('{"a": 1}');
    component.selectFormat("raw");

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/zone-a",
      encode('{"a": 1}'),
      "AtMostOnce",
      false,
    );
  });

  it("uses the selected QoS when publishing", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("hello");
    component.selectFormat("raw");
    clickSegment(fixture, ".qos-option", "Q2");

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/zone-a",
      encode("hello"),
      "ExactlyOnce",
      false,
    );
  });

  it("shows a published flash after a successful publish, and it clears after a timeout", async () => {
    vi.useFakeTimers();
    const { fixture } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("hello");
    component.selectFormat("raw");

    await component.publish();

    expect(component.publishedFlash()).toBe(true);

    vi.advanceTimersByTime(5000);

    expect(component.publishedFlash()).toBe(false);
  });

  it("clears a previous error on a successful publish", async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("not connected"))
      .mockResolvedValueOnce(undefined);
    const { fixture } = await setup(publish);
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("hello");
    component.selectFormat("raw");
    await component.publish();
    expect(component.publishError()).toBeTruthy();

    await component.publish();

    expect(component.publishError()).toBeNull();
  });

  it("shows an error and no flash if the publish call is rejected", async () => {
    const publish = vi.fn().mockRejectedValue(new Error("not connected"));
    const { fixture } = await setup(publish);
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("hello");
    component.selectFormat("raw");

    await component.publish();

    expect(component.publishError()).toBe("not connected");
    expect(component.publishedFlash()).toBe(false);
  });

  it("selecting a format/QoS segment updates its selected state", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    expect(component.format()).toBe("json");
    expect(component.qos()).toBe("AtMostOnce");

    component.selectFormat("raw");
    clickSegment(fixture, ".qos-option", "Q1");

    expect(component.format()).toBe("raw");
    expect(component.qos()).toBe("AtLeastOnce");
  });

  describe("formatPayload", () => {
    it("pretty-prints valid JSON in the payload field", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.payload.setValue('{"a": 1,   "b": 2}');

      component.formatPayload();

      expect(component.form.controls.payload.value).toBe(
        '{\n  "a": 1,\n  "b": 2\n}',
      );
    });

    it("shows an error and leaves the field untouched for invalid JSON", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.payload.setValue("not valid json");

      component.formatPayload();

      expect(component.form.controls.payload.value).toBe("not valid json");
      expect(component.publishError()).toBeTruthy();
    });

    it("only shows the Format action while in JSON format", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;

      let button = (fixture.nativeElement as HTMLElement).querySelector(
        ".format-action",
      );
      expect(button).not.toBeNull();

      component.selectFormat("raw");
      fixture.detectChanges();

      button = (fixture.nativeElement as HTMLElement).querySelector(
        ".format-action",
      );
      expect(button).toBeNull();
    });
  });
});
