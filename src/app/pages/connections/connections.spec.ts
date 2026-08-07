import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { UpdateAnnouncement } from "../../core/services/update-announcement";
import { UpdateNotifierService } from "../../core/services/update-notifier.service";
import { Connections } from "./connections";

/** Stands in for the real notifier, which would otherwise reach for the Tauri
 *  bridge from its constructor. */
function fakeNotifier(
  checkManually: () => Promise<UpdateAnnouncement> = () =>
    Promise.resolve({ kind: "up-to-date" }),
) {
  return {
    available: signal(null),
    currentVersion: signal("0.7.0"),
    checkManually: vi.fn(checkManually),
    dismiss: vi.fn(),
    skip: vi.fn(),
  };
}

function sampleConnection(
  overrides: Partial<BrokerConnection> = {},
): BrokerConnection {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Local",
    host: "localhost",
    port: 1883,
    client_id: "bme",
    username: null,
    password: null,
    use_tls: false,
    keep_alive_secs: 30,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
    ...overrides,
  };
}

async function setup(
  connections: BrokerConnection[],
  notifier = fakeNotifier(),
) {
  const fake = {
    list: vi.fn().mockResolvedValue(connections),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [Connections],
    providers: [
      provideRouter([]),
      { provide: ConnectionsService, useValue: fake },
      { provide: UpdateNotifierService, useValue: notifier },
    ],
  });

  const fixture = TestBed.createComponent(Connections);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, fake, notifier };
}

describe("Connections", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the list of connections from the service", async () => {
    const { fixture } = await setup([
      sampleConnection({ name: "Home Assistant" }),
    ]);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Home Assistant");
    expect(text).toContain("localhost:1883");
  });

  it("links to the templates management page", async () => {
    const { fixture } = await setup([]);

    const link = (fixture.nativeElement as HTMLElement).querySelector(
      'a[href="/templates"]',
    );
    expect(link).toBeTruthy();
  });

  it("shows an empty state when there are no connections", async () => {
    const { fixture } = await setup([]);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No connections yet");
  });

  it("deletes a connection when Delete is clicked", async () => {
    const connection = sampleConnection();
    const { fixture, fake } = await setup([connection]);

    await fixture.componentInstance.deleteConnection(
      connection.id,
      new Event("click"),
    );

    expect(fake.delete).toHaveBeenCalledWith(connection.id);
  });

  it("closes the open menu on a click anywhere outside it", async () => {
    const connection = sampleConnection();
    const { fixture } = await setup([connection]);
    const component = fixture.componentInstance;

    component.toggleMenu(connection.id, new Event("click"));
    expect(component.openMenuId()).toBe(connection.id);

    document.dispatchEvent(new Event("click"));

    expect(component.openMenuId()).toBeNull();
  });

  it("shows the running version in the footer", async () => {
    const { fixture } = await setup([]);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".footer-version")
        ?.textContent,
    ).toContain("v0.7.0");
  });

  it("says so when a manual check finds nothing newer", async () => {
    const { fixture } = await setup([]);

    await fixture.componentInstance.checkForUpdates();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".footer-status")
        ?.textContent,
    ).toContain("You're on the latest version");
  });

  it("says nothing extra when a manual check finds an update - the dialog is the message", async () => {
    const { fixture } = await setup(
      [],
      fakeNotifier(() =>
        Promise.resolve({
          kind: "update",
          release: {
            version: "0.8.0",
            name: null,
            notes: null,
            url: "https://example.invalid",
            published_at: null,
            is_newer: true,
            is_skipped: false,
          },
        }),
      ),
    );

    await fixture.componentInstance.checkForUpdates();
    fixture.detectChanges();

    expect(fixture.componentInstance.updateStatus()).toBeNull();
  });

  it("shows the error when a manual check fails", async () => {
    const { fixture } = await setup(
      [],
      fakeNotifier(() => Promise.reject(new Error("could not reach GitHub"))),
    );

    await fixture.componentInstance.checkForUpdates();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".footer-status")
        ?.textContent,
    ).toContain("could not reach GitHub");
  });

  it("ignores a second press while a check is already running", async () => {
    let release!: (announcement: UpdateAnnouncement) => void;
    const notifier = fakeNotifier(
      () => new Promise<UpdateAnnouncement>((resolve) => (release = resolve)),
    );
    const { fixture } = await setup([], notifier);
    const component = fixture.componentInstance;

    const first = component.checkForUpdates();
    expect(component.checkingUpdate()).toBe(true);
    await component.checkForUpdates();

    release({ kind: "up-to-date" });
    await first;

    expect(notifier.checkManually).toHaveBeenCalledOnce();
    expect(component.checkingUpdate()).toBe(false);
  });
});
