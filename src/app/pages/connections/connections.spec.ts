import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { Connections } from "./connections";

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

async function setup(connections: BrokerConnection[]) {
  const fake = {
    list: vi.fn().mockResolvedValue(connections),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [Connections],
    providers: [
      provideRouter([]),
      { provide: ConnectionsService, useValue: fake },
    ],
  });

  const fixture = TestBed.createComponent(Connections);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, fake };
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
});
