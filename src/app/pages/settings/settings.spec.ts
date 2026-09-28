import { computed, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, vi } from "vitest";

import { SettingsService } from "../../core/services/settings.service";
import {
  AppSettings,
  DEFAULT_SETTINGS,
} from "../../core/settings/app-settings";
import { Settings } from "./settings";

async function setup(overrides: Partial<AppSettings> = {}) {
  const settings = signal<AppSettings>({ ...DEFAULT_SETTINGS, ...overrides });
  const service = {
    settings,
    value: (key: keyof AppSettings) => computed(() => settings()[key]),
    load: vi.fn().mockResolvedValue(undefined),
    // Mirrors the real service's optimistic update, so the page re-renders
    // the way it does in the app.
    set: vi.fn(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      settings.update((s) => ({ ...s, [key]: value }));
      return Promise.resolve();
    }),
    resetAll: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [Settings],
    providers: [
      provideRouter([]),
      { provide: SettingsService, useValue: service },
    ],
  });

  const fixture = TestBed.createComponent(Settings);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    service,
    settings,
    element,
    segment(group: string, label: string): HTMLElement {
      const match = [
        ...element.querySelectorAll<HTMLElement>(
          `[aria-labelledby="${group}"] .segment`,
        ),
      ].find((el) => el.textContent?.trim() === label);
      if (match === undefined)
        throw new Error(`no segment "${label}" in ${group}`);
      return match;
    },
  };
}

describe("Settings", () => {
  it("loads on init so a failed startup load gets a retry", async () => {
    const { service } = await setup();
    expect(service.load).toHaveBeenCalled();
  });

  it("renders the current values", async () => {
    const { element, segment } = await setup({
      timestampMode: "absolute",
      prettyJson: false,
      maxMessagesPerTopic: 250,
      publishFormat: "raw",
      publishQos: "AtLeastOnce",
      publishRetain: true,
      subscribeQos: "ExactlyOnce",
    });

    expect(segment("timestampsLabel", "Real time").classList).toContain(
      "selected",
    );
    expect(segment("formatLabel", "RAW").classList).toContain("selected");
    expect(
      element.querySelector<HTMLInputElement>(".pretty-json-checkbox")?.checked,
    ).toBe(false);
    expect(element.querySelector<HTMLInputElement>("#maxMessages")?.value).toBe(
      "250",
    );
    expect(
      element.querySelector<HTMLInputElement>(".retain-checkbox")?.checked,
    ).toBe(true);
    expect(
      element
        .querySelector(".publish-qos .qos-option.selected")
        ?.textContent?.trim(),
    ).toBe("Q1");
    expect(
      element
        .querySelector(".subscribe-qos .qos-option.selected")
        ?.textContent?.trim(),
    ).toBe("Q2");
  });

  it("writes each control straight through to the service", async () => {
    const { element, fixture, service, segment } = await setup();

    segment("timestampsLabel", "Real time").click();
    expect(service.set).toHaveBeenCalledWith("timestampMode", "absolute");

    segment("formatLabel", "RAW").click();
    expect(service.set).toHaveBeenCalledWith("publishFormat", "raw");

    const pretty = element.querySelector<HTMLInputElement>(
      ".pretty-json-checkbox",
    )!;
    pretty.click();
    expect(service.set).toHaveBeenCalledWith("prettyJson", false);

    const retain = element.querySelector<HTMLInputElement>(".retain-checkbox")!;
    retain.click();
    expect(service.set).toHaveBeenCalledWith("publishRetain", true);

    const publishQ2 = [
      ...element.querySelectorAll<HTMLElement>(".publish-qos .qos-option"),
    ].find((el) => el.textContent?.trim() === "Q2")!;
    publishQ2.click();
    expect(service.set).toHaveBeenCalledWith("publishQos", "ExactlyOnce");

    const subscribeQ1 = [
      ...element.querySelectorAll<HTMLElement>(".subscribe-qos .qos-option"),
    ].find((el) => el.textContent?.trim() === "Q1")!;
    subscribeQ1.click();
    expect(service.set).toHaveBeenCalledWith("subscribeQos", "AtLeastOnce");

    fixture.detectChanges();
    expect(segment("timestampsLabel", "Real time").classList).toContain(
      "selected",
    );
  });

  it("commits the message cap on change and shows what the service kept", async () => {
    const { element, service } = await setup();
    const input = element.querySelector<HTMLInputElement>("#maxMessages")!;

    input.value = "42";
    input.dispatchEvent(new Event("change"));
    expect(service.set).toHaveBeenCalledWith("maxMessagesPerTopic", 42);
    expect(input.value).toBe("42");

    // The real service clamps; the field must follow the signal, not the
    // typed text, even when the clamp lands on the value it already had.
    service.set.mockImplementationOnce(() => Promise.resolve());
    input.value = "5";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("42");
  });

  it("restores the current value when the cap field is emptied", async () => {
    const { element, service } = await setup({ maxMessagesPerTopic: 300 });
    const input = element.querySelector<HTMLInputElement>("#maxMessages")!;

    input.value = "";
    input.dispatchEvent(new Event("change"));

    expect(service.set).not.toHaveBeenCalled();
    expect(input.value).toBe("300");
  });

  it("resets everything through the service", async () => {
    const { element, service } = await setup();

    [...element.querySelectorAll<HTMLElement>("button")]
      .find((el) => el.textContent?.trim() === "Reset to defaults")!
      .click();

    expect(service.resetAll).toHaveBeenCalled();
  });

  it("surfaces a failed write", async () => {
    const { element, fixture, service, segment } = await setup();
    service.set.mockRejectedValueOnce(new Error("disk full"));

    segment("formatLabel", "RAW").click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector(".status-text.error")?.textContent).toContain(
      "disk full",
    );
  });
});
