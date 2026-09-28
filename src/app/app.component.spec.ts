import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, vi } from "vitest";

import { AppComponent } from "./app.component";
import { ConnectionsService } from "./core/services/connections.service";
import { MessageStoreService } from "./core/services/message-store.service";
import { MqttEventsService } from "./core/services/mqtt-events.service";
import { UiZoomService } from "./core/services/ui-zoom.service";
import { UpdateNotifierService } from "./core/services/update-notifier.service";
import { ValueChartsService } from "./core/services/value-charts.service";
import { Subject } from "rxjs";

async function setup() {
  const uiZoom = {
    stepIn: vi.fn(),
    stepOut: vi.fn(),
    reset: vi.fn(),
  };

  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideRouter([]),
      { provide: UiZoomService, useValue: uiZoom },
      {
        provide: UpdateNotifierService,
        useValue: {
          available: signal(null),
          currentVersion: signal("0.9.0"),
          dismiss: vi.fn(),
          skip: vi.fn(),
        },
      },
      { provide: MqttEventsService, useValue: { events$: new Subject() } },
      { provide: MessageStoreService, useValue: { clear: vi.fn() } },
      { provide: ValueChartsService, useValue: { removeAllFor: vi.fn() } },
      {
        provide: ConnectionsService,
        useValue: { get: vi.fn().mockResolvedValue(null) },
      },
    ],
  });

  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, uiZoom };
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

describe("AppComponent zoom shortcuts", () => {
  it("steps the interface size with Ctrl and + / -", async () => {
    const { uiZoom } = await setup();

    press("=", { ctrlKey: true });
    expect(uiZoom.stepIn).toHaveBeenCalledTimes(1);

    press("-", { ctrlKey: true });
    expect(uiZoom.stepOut).toHaveBeenCalledTimes(1);
  });

  it("resets with Ctrl+0", async () => {
    const { uiZoom } = await setup();

    press("0", { ctrlKey: true });

    expect(uiZoom.reset).toHaveBeenCalledTimes(1);
  });

  it("stops the webview acting on the same keypress", async () => {
    await setup();

    expect(press("=", { ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it("leaves every other keypress alone", async () => {
    const { uiZoom } = await setup();

    const untouched = press("f", { ctrlKey: true });
    press("0");

    expect(untouched.defaultPrevented).toBe(false);
    expect(uiZoom.stepIn).not.toHaveBeenCalled();
    expect(uiZoom.stepOut).not.toHaveBeenCalled();
    expect(uiZoom.reset).not.toHaveBeenCalled();
  });

  it("works while a text field has focus, the way browser zoom does", async () => {
    const { uiZoom } = await setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "=",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(uiZoom.stepIn).toHaveBeenCalledTimes(1);
    input.remove();
  });
});
