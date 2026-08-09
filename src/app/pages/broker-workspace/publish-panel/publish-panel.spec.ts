import { computed, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { MessageDraft } from "../../../core/models/message-draft.model";
import {
  PayloadVariable,
  VariableGenerator,
  valueKindOf,
} from "../../../core/models/payload-variable.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { VariablesService } from "../../../core/services/variables.service";
import { PublishPanel } from "./publish-panel";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function variable(
  name: string,
  generator: VariableGenerator,
  id = name,
): PayloadVariable {
  return { id, name, generator, created_at: "2026-01-01T00:00:00Z" };
}

async function setup(
  publish = vi.fn().mockResolvedValue(undefined),
  variables: PayloadVariable[] = [],
) {
  const mqttService = { publish };
  const favoritesService = {
    create: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
  };
  const favoriteCollectionsService = { list: vi.fn().mockResolvedValue([]) };

  // The panel only reads from the service; the cache signals are what it
  // consumes, so a fake that exposes them is enough and keeps IPC out.
  const variablesSignal = signal<readonly PayloadVariable[]>(variables);
  const variablesService = {
    variables: variablesSignal.asReadonly(),
    valueKinds: computed(
      () =>
        new Map(variablesSignal().map((v) => [v.name, valueKindOf(v.generator)])),
    ),
    load: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [PublishPanel],
    providers: [
      { provide: MqttService, useValue: mqttService },
      { provide: FavoritesService, useValue: favoritesService },
      {
        provide: FavoriteCollectionsService,
        useValue: favoriteCollectionsService,
      },
      { provide: VariablesService, useValue: variablesService },
    ],
  });

  const fixture = TestBed.createComponent(PublishPanel);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, mqttService, publish, favoritesService };
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

  it("fills the topic field from setTopic", async () => {
    const { fixture } = await setup();

    fixture.componentInstance.setTopic("sensors/zone-a");
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.topic.value).toBe(
      "sensors/zone-a",
    );
  });

  it("restores the same topic after the field was edited by hand", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.setTopic("sensors/zone-a");
    component.form.controls.topic.setValue("typed/by/hand");
    component.setTopic("sensors/zone-a");
    fixture.detectChanges();

    expect(component.form.controls.topic.value).toBe("sensors/zone-a");
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

  it("blocks publishing invalid JSON while in JSON format", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("not valid json");

    await component.publish();

    expect(publish).not.toHaveBeenCalled();
    expect(component.payloadInvalid()).toBe(true);
  });

  it("allows publishing the same invalid text once switched to RAW format", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("not valid json");
    component.selectFormat("raw");

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

  it("does not retain by default", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("hello");
    component.selectFormat("raw");

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/zone-a",
      encode("hello"),
      "AtMostOnce",
      false,
    );
  });

  it("passes retain=true when the retain checkbox is checked", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/zone-a");
    component.form.controls.payload.setValue("hello");
    component.selectFormat("raw");
    component.toggleRetain();

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/zone-a",
      encode("hello"),
      "AtMostOnce",
      true,
    );
  });

  it("toggles the retain checkbox in the DOM", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    expect(component.retain()).toBe(false);

    // Retain lives on the settings layer now: it's set once for a draft and
    // then left alone, so it doesn't earn a slot in the main row.
    component.toggleSettings();
    fixture.detectChanges();

    const checkbox = (fixture.nativeElement as HTMLElement).querySelector(
      ".retain-checkbox",
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    expect(component.retain()).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  it("does not show the retain checkbox on the main layer", async () => {
    const { fixture } = await setup();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".retain-checkbox"),
    ).toBeNull();
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

  describe("payloadInvalid", () => {
    it("is false while the payload is empty", async () => {
      const { fixture } = await setup();

      expect(fixture.componentInstance.payloadInvalid()).toBe(false);
    });

    it("is true for malformed JSON while in JSON format", async () => {
      const { fixture } = await setup();
      fixture.componentInstance.form.controls.payload.setValue("not json");

      expect(fixture.componentInstance.payloadInvalid()).toBe(true);
    });

    it("is false for malformed JSON once switched to RAW format", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.payload.setValue("not json");
      component.selectFormat("raw");

      expect(component.payloadInvalid()).toBe(false);
    });

    it("disables the Publish and Save as Template buttons in the DOM", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/zone-a");
      component.form.controls.payload.setValue("not json");
      fixture.detectChanges();

      const publishButton = (fixture.nativeElement as HTMLElement).querySelector(
        ".btn-publish",
      ) as HTMLButtonElement;
      const saveButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          ".btn-save-template",
        ),
      ).find((el) => el.textContent?.trim() === "Save as Template") as HTMLButtonElement;

      expect(publishButton.disabled).toBe(true);
      expect(saveButton.disabled).toBe(true);
    });
  });

  describe("connected input", () => {
    it("disables only the Publish button while disconnected, even with a valid form", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/zone-a");
      component.form.controls.payload.setValue("hello");
      component.selectFormat("raw");
      fixture.componentRef.setInput("connected", false);
      fixture.detectChanges();

      const publishButton = (fixture.nativeElement as HTMLElement).querySelector(
        ".btn-publish",
      ) as HTMLButtonElement;
      const saveButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          ".btn-save-template",
        ),
      ).find((el) => el.textContent?.trim() === "Save as Template") as HTMLButtonElement;

      expect(publishButton.disabled).toBe(true);
      expect(publishButton.title).toBe("Connect to the broker to publish");
      expect(saveButton.disabled).toBe(false);
    });

    it("enables the Publish button once connected with a valid form", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/zone-a");
      component.form.controls.payload.setValue("hello");
      component.selectFormat("raw");
      fixture.componentRef.setInput("connected", true);
      fixture.detectChanges();

      const publishButton = (fixture.nativeElement as HTMLElement).querySelector(
        ".btn-publish",
      ) as HTMLButtonElement;

      expect(publishButton.disabled).toBe(false);
      expect(publishButton.title).toBe("");
    });
  });

  describe("Save Template modal", () => {
    it("does not open the modal when the topic field is empty", async () => {
      const { fixture } = await setup();
      fixture.componentInstance.form.controls.payload.setValue("{}");

      fixture.componentInstance.openSaveModal();

      expect(fixture.componentInstance.saveModalDraft()).toBeNull();
    });

    it("does not open the modal when the payload field is empty", async () => {
      const { fixture } = await setup();
      fixture.componentInstance.form.controls.topic.setValue("sensors/zone-a");

      fixture.componentInstance.openSaveModal();

      expect(fixture.componentInstance.saveModalDraft()).toBeNull();
    });

    it("opens the modal with a snapshot of the current topic/payload/format/qos/retain", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/zone-a");
      component.form.controls.payload.setValue('{"a": 1,   "b": 2}');
      component.toggleRetain();

      component.openSaveModal();
      fixture.detectChanges();

      expect(component.saveModalDraft()).toEqual({
        topic: "sensors/zone-a",
        payload: '{"a":1,"b":2}',
        format: "json",
        qos: "AtMostOnce",
        retain: true,
      });
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          "app-save-template-modal",
        ),
      ).not.toBeNull();
    });

    it("closes the modal when the modal emits close", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/zone-a");
      component.form.controls.payload.setValue("{}");
      component.openSaveModal();
      fixture.detectChanges();

      component.closeSaveModal();

      expect(component.saveModalDraft()).toBeNull();
    });

    it("shows a confirmation flash and closes the modal when the modal emits saved, clearing after a timeout", async () => {
      vi.useFakeTimers();
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/zone-a");
      component.form.controls.payload.setValue("{}");
      component.openSaveModal();

      component.onTemplateSaved();

      expect(component.saveModalDraft()).toBeNull();
      expect(component.templateSaved()).toBe(true);

      vi.advanceTimersByTime(5000);

      expect(component.templateSaved()).toBe(false);
    });
  });

  describe("Load Template modal", () => {
    const TEMPLATE: FavoriteMessage = {
      id: "55555555-5555-5555-5555-555555555555",
      collection_id: null,
      name: "Zone A",
      description: null,
      topic: "sensors/zone-a",
      payload: '{"a":1}',
      format: "raw",
      qos: "ExactlyOnce",
      retain: true,
      created_at: "2026-07-18T00:00:00Z",
    };

    it("opens the modal when Load Template is clicked", async () => {
      const { fixture } = await setup();

      fixture.componentInstance.openLoadModal();
      fixture.detectChanges();

      expect(fixture.componentInstance.showLoadModal()).toBe(true);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          "app-load-template-modal",
        ),
      ).not.toBeNull();
    });

    it("closes the modal when the modal emits close", async () => {
      const { fixture } = await setup();
      fixture.componentInstance.openLoadModal();

      fixture.componentInstance.closeLoadModal();

      expect(fixture.componentInstance.showLoadModal()).toBe(false);
    });

    it("applies the selected template's topic/payload/format/qos/retain and closes the modal", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.openLoadModal();

      component.onTemplateSelected(TEMPLATE);

      expect(component.form.controls.topic.value).toBe("sensors/zone-a");
      expect(component.form.controls.payload.value).toBe('{"a":1}');
      expect(component.format()).toBe("raw");
      expect(component.qos()).toBe("ExactlyOnce");
      expect(component.retain()).toBe(true);
      expect(component.showLoadModal()).toBe(false);
    });

    it("plainly overwrites an already-filled-in draft", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("unrelated/topic");
      component.form.controls.payload.setValue("unrelated payload");
      component.openLoadModal();

      component.onTemplateSelected(TEMPLATE);

      expect(component.form.controls.topic.value).toBe("sensors/zone-a");
      expect(component.form.controls.payload.value).toBe('{"a":1}');
    });
  });

  describe("loadDraft", () => {
    const DRAFT: MessageDraft = {
      topic: "sensors/zone-b",
      payload: '{"b":2}',
      format: "json",
      qos: "AtLeastOnce",
      retain: true,
    };

    it("fills the whole draft from a resent message", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;

      component.loadDraft(DRAFT);

      expect(component.form.controls.topic.value).toBe("sensors/zone-b");
      expect(component.form.controls.payload.value).toBe('{"b":2}');
      expect(component.format()).toBe("json");
      expect(component.qos()).toBe("AtLeastOnce");
      expect(component.retain()).toBe(true);
    });

    it("clears a stale publish error, since the draft it referred to is gone", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.publishError.set("Not connected to the broker");

      component.loadDraft(DRAFT);

      expect(component.publishError()).toBeNull();
    });
  });
});

describe("PublishPanel payload variables", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("expands a placeholder in the payload before publishing", async () => {
    const { fixture, publish } = await setup(undefined, [
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({
      topic: "sensors/temp",
      payload: '{"id":"{{deviceId}}"}',
    });

    await component.publish();

    expect(publish).toHaveBeenCalledWith(
      CONNECTION_ID,
      "sensors/temp",
      encode('{"id":"dev-42"}'),
      "AtMostOnce",
      false,
    );
  });

  it("expands placeholders in the topic too", async () => {
    const { fixture, publish } = await setup(undefined, [
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "sensors/{{deviceId}}/temp", payload: "1" });

    await component.publish();

    expect(publish.mock.calls[0][1]).toBe("sensors/dev-42/temp");
  });

  it("sends an unknown placeholder as written rather than blanking it", async () => {
    // A payload may contain braces for reasons that have nothing to do with
    // bme, so an unresolved name passes through untouched.
    const { fixture, publish } = await setup(undefined, []);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: '{"note":"{{typo}}"}' });

    await component.publish();

    expect(publish.mock.calls[0][2]).toEqual(encode('{"note":"{{typo}}"}'));
  });

  it("blocks publishing when an unknown placeholder breaks the JSON", async () => {
    const { fixture, publish } = await setup(undefined, []);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: '{"n":{{typo}}}' });

    await component.publish();

    expect(component.payloadInvalid()).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it("reports unknown placeholder names from both fields", async () => {
    const { fixture } = await setup(undefined, [
      variable("known", { kind: "uuid" }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({
      topic: "sensors/{{missingTopic}}",
      payload: "{{known}} {{missingBody}}",
    });

    expect(component.unknownVariables()).toEqual([
      "missingTopic",
      "missingBody",
    ]);
  });

  it("accepts a numeric placeholder in a JSON value position", async () => {
    // Literal JSON.parse would reject this; the probe expansion is what makes
    // the simulator payload publishable.
    const { fixture } = await setup(undefined, [
      variable("tempC", { kind: "randomInt", min: 18, max: 24 }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: '{"t":{{tempC}}}' });

    expect(component.payloadInvalid()).toBe(false);
  });

  it("still rejects a string placeholder used unquoted in JSON", async () => {
    const { fixture } = await setup(undefined, [
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: '{"id":{{deviceId}}}' });

    expect(component.payloadInvalid()).toBe(true);
  });

  it("previews the expansion of both fields, and nothing when there is none", async () => {
    const { fixture } = await setup(undefined, [
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);
    const component = fixture.componentInstance;

    component.form.setValue({ topic: "plain/topic", payload: '{"a":1}' });
    expect(component.preview()).toBeNull();

    component.form.setValue({
      topic: "sensors/{{deviceId}}",
      payload: '{"id":"{{deviceId}}"}',
    });
    expect(component.preview()).toEqual({
      topic: "sensors/dev-42",
      payload: '{"id":"dev-42"}',
    });
  });

  it("refreshes the preview when the topic is edited", async () => {
    // A reactive form control's `.value` is a plain property, so a computed
    // reading it never recomputes - the preview used to stay frozen.
    const { fixture } = await setup(undefined, [
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "a/{{deviceId}}", payload: '{"x":1}' });
    expect(component.preview()?.topic).toBe("a/dev-42");

    component.form.controls.topic.setValue("b/{{deviceId}}");

    expect(component.preview()?.topic).toBe("b/dev-42");
  });

  it("does not let the preview advance the counter a publish will use", async () => {
    const { fixture, publish } = await setup(undefined, [
      variable("seq", { kind: "counter", start: 1, step: 1 }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: "{{seq}}" });

    expect(component.preview()?.payload).toBe("1");
    expect(component.preview()?.payload).toBe("1");

    await component.publish();

    expect(publish.mock.calls[0][2]).toEqual(encode("1"));
  });

  it("moves the preview on as the counter advances", async () => {
    const { fixture } = await setup(undefined, [
      variable("seq", { kind: "counter", start: 1, step: 1 }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: "{{seq}}" });
    expect(component.preview()?.payload).toBe("1");

    await component.publish();

    expect(component.preview()?.payload).toBe("2");
  });
});

describe("PublishPanel counter lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function withCounter() {
    const result = await setup(undefined, [
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
    ]);
    const component = result.fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: "{{seq}}" });
    return { ...result, component };
  }

  it("keeps counting across one-off publishes rather than resetting each time", async () => {
    const { component, publish } = await withCounter();

    await component.publish();
    await component.publish();
    await component.publish();

    expect(publish.mock.calls.map((call) => call[2])).toEqual([
      encode("1"),
      encode("2"),
      encode("3"),
    ]);
  });

  it("restarts the counter when a repeat run starts", async () => {
    vi.useFakeTimers();
    const { component, publish } = await withCounter();
    await component.publish();
    await component.publish();

    component.toggleRepeatEnabled();
    component.onIntervalInput("100");
    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);

    expect(publish.mock.calls[2][2]).toEqual(encode("1"));
  });

  it("restarts the counter on an explicit reset", async () => {
    const { component, publish } = await withCounter();
    await component.publish();
    await component.publish();

    component.resetCounters();
    await component.publish();

    expect(publish.mock.calls[2][2]).toEqual(encode("1"));
  });

  it("reports where each counter has got to, for the modal readout", async () => {
    const { component } = await withCounter();
    expect([...component.counterValues()]).toEqual([["id-seq", "1"]]);

    await component.publish();

    expect([...component.counterValues()]).toEqual([["id-seq", "2"]]);

    component.resetCounters();

    expect([...component.counterValues()]).toEqual([["id-seq", "1"]]);
  });

  it("resets one counter without disturbing the others", async () => {
    const { fixture } = await setup(undefined, [
      variable("a", { kind: "counter", start: 1, step: 1 }, "id-a"),
      variable("b", { kind: "counter", start: 1, step: 1 }, "id-b"),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: '{"a":{{a}},"b":{{b}}}' });
    await component.publish();
    await component.publish();

    component.resetCounter("id-a");

    expect([...component.counterValues()]).toEqual([
      ["id-a", "1"],
      ["id-b", "3"],
    ]);
  });

  it("lists no counters when none of the variables are stateful", async () => {
    const { fixture } = await setup(undefined, [
      variable("id", { kind: "uuid" }),
    ]);

    expect(fixture.componentInstance.counterValues().size).toBe(0);
  });

  it("saves a template with its placeholders intact", async () => {
    const { fixture } = await setup(undefined, [
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: '{"id":"{{deviceId}}"}' });

    component.openSaveModal();

    expect(component.saveModalDraft()?.payload).toBe('{"id":"{{deviceId}}"}');
  });
});

describe("PublishPanel repeat publishing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Arms a repeat run with a valid draft, without going through the DOM. */
  async function armed(
    options: {
      publish?: Parameters<typeof setup>[0];
      variables?: PayloadVariable[];
      payload?: string;
      count?: number | null;
      intervalMs?: number;
    } = {},
  ) {
    const result = await setup(options.publish, options.variables ?? []);
    const component = result.fixture.componentInstance;
    component.form.setValue({
      topic: "sensors/temp",
      payload: options.payload ?? "1",
    });
    component.toggleRepeatEnabled();
    component.onIntervalInput(String(options.intervalMs ?? 500));
    if (options.count != null) {
      component.toggleRepeatForever();
      component.onRepeatCountInput(String(options.count));
    }
    return { ...result, component };
  }

  it("is off by default, so the button still just publishes once", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: "1" });

    await component.submit();

    expect(component.running()).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("sends the first message immediately, without waiting an interval", async () => {
    vi.useFakeTimers();
    const { component, publish } = await armed();

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(component.sentCount()).toBe(1);
  });

  it("keeps sending on the configured interval", async () => {
    vi.useFakeTimers();
    const { component, publish } = await armed({ intervalMs: 500 });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(1100);

    expect(publish).toHaveBeenCalledTimes(3);
    expect(component.running()).toBe(true);
  });

  it("stops on its own after the configured count", async () => {
    vi.useFakeTimers();
    const { component, publish } = await armed({ count: 3, intervalMs: 100 });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(1000);

    expect(publish).toHaveBeenCalledTimes(3);
    expect(component.running()).toBe(false);
    expect(component.finishedFlash()).toBe("✓ Sent 3 messages");
  });

  it("clears the finished confirmation after a moment", async () => {
    vi.useFakeTimers();
    const { component } = await armed({ count: 1, intervalMs: 100 });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);
    expect(component.finishedFlash()).toBe("✓ Sent 1 message");

    await vi.advanceTimersByTimeAsync(1800);

    expect(component.finishedFlash()).toBeNull();
  });

  it("drops a stale finished confirmation when the next run starts", async () => {
    vi.useFakeTimers();
    const { component } = await armed({ count: 1, intervalMs: 100 });
    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);

    component.startRepeat();

    expect(component.finishedFlash()).toBeNull();
  });

  it("advances a counter variable across the run", async () => {
    vi.useFakeTimers();
    const { component, publish } = await armed({
      variables: [variable("seq", { kind: "counter", start: 1, step: 1 })],
      payload: "{{seq}}",
      count: 3,
      intervalMs: 100,
    });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(1000);

    expect(publish.mock.calls.map((call) => call[2])).toEqual([
      encode("1"),
      encode("2"),
      encode("3"),
    ]);
  });

  it("restarts the counter when a new run begins", async () => {
    vi.useFakeTimers();
    const { component, publish } = await armed({
      variables: [variable("seq", { kind: "counter", start: 1, step: 1 })],
      payload: "{{seq}}",
      count: 2,
      intervalMs: 100,
    });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(500);
    component.startRepeat();
    await vi.advanceTimersByTimeAsync(500);

    expect(publish.mock.calls.map((call) => call[2])).toEqual([
      encode("1"),
      encode("2"),
      encode("1"),
      encode("2"),
    ]);
  });

  it("stops the run and reports how far it got when a publish fails", async () => {
    vi.useFakeTimers();
    const publish = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("Not connected to the broker"));
    const { component } = await armed({ publish, intervalMs: 100 });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(1000);

    expect(component.running()).toBe(false);
    expect(component.sentCount()).toBe(2);
    expect(component.publishError()).toBe(
      "Repeat stopped after 2 messages: Not connected to the broker",
    );
  });

  it("sends nothing more after Stop", async () => {
    vi.useFakeTimers();
    const { component, publish } = await armed({ intervalMs: 100 });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(250);
    const sentBeforeStop = publish.mock.calls.length;
    component.stopRepeat();
    await vi.advanceTimersByTimeAsync(1000);

    expect(publish).toHaveBeenCalledTimes(sentBeforeStop);
    expect(component.running()).toBe(false);
  });

  it("submit stops a live run instead of starting a second one", async () => {
    vi.useFakeTimers();
    const { component } = await armed({ intervalMs: 100 });
    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);

    await component.submit();

    expect(component.running()).toBe(false);
  });

  it("turning repeat off stops a live run", async () => {
    vi.useFakeTimers();
    const { component } = await armed({ intervalMs: 100 });
    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);

    component.toggleRepeatEnabled();

    expect(component.repeatEnabled()).toBe(false);
    expect(component.running()).toBe(false);
  });

  it("refuses to start with an invalid draft", async () => {
    const { fixture, publish } = await setup();
    const component = fixture.componentInstance;
    component.toggleRepeatEnabled();
    component.form.setValue({ topic: "", payload: "" });

    component.startRepeat();

    expect(component.running()).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses to start while disconnected", async () => {
    const { fixture, publish } = await setup();
    fixture.componentRef.setInput("connected", false);
    const component = fixture.componentInstance;
    component.form.setValue({ topic: "t", payload: "1" });
    component.toggleRepeatEnabled();

    component.startRepeat();

    expect(component.running()).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("clamps a hand-typed interval into the supported range", async () => {
    const { component } = await armed();

    component.onIntervalInput("0");
    expect(component.intervalMs()).toBe(10);

    component.onIntervalInput("99999999");
    expect(component.intervalMs()).toBe(3_600_000);
  });

  it("summarises the configured run for the chip", async () => {
    const { component } = await armed({ intervalMs: 500 });
    expect(component.repeatSummary()).toBe("every 500 ms × ∞");

    component.toggleRepeatForever();
    component.onRepeatCountInput("25");

    expect(component.repeatSummary()).toBe("every 500 ms × 25");
  });

  it("shows progress in the header while running", async () => {
    vi.useFakeTimers();
    const { component } = await armed({ count: 5, intervalMs: 100 });

    component.startRepeat();
    await vi.advanceTimersByTimeAsync(150);

    expect(component.repeatProgress()).toBe("Repeating · 2 of 5 sent");
  });

  it("stops a live run when the panel is destroyed", async () => {
    vi.useFakeTimers();
    const { fixture, component, publish } = await armed({ intervalMs: 100 });
    component.startRepeat();
    await vi.advanceTimersByTimeAsync(0);
    const sentBeforeDestroy = publish.mock.calls.length;

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(1000);

    expect(publish).toHaveBeenCalledTimes(sentBeforeDestroy);
  });
});
