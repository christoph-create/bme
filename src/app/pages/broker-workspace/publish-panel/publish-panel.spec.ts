import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { PublishPanel } from "./publish-panel";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function setup(publish = vi.fn().mockResolvedValue(undefined)) {
  const mqttService = { publish };
  const favoritesService = {
    create: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
  };
  const favoriteCollectionsService = { list: vi.fn().mockResolvedValue([]) };

  TestBed.configureTestingModule({
    imports: [PublishPanel],
    providers: [
      { provide: MqttService, useValue: mqttService },
      { provide: FavoritesService, useValue: favoritesService },
      {
        provide: FavoriteCollectionsService,
        useValue: favoriteCollectionsService,
      },
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

    const checkbox = (fixture.nativeElement as HTMLElement).querySelector(
      ".retain-checkbox",
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    expect(component.retain()).toBe(true);
    expect(checkbox.checked).toBe(true);
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
});
