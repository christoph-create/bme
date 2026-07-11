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

  it("shows an empty state when there are no connections", async () => {
    const { fixture } = await setup([]);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No connections yet");
  });

  it("deletes a connection after confirming", async () => {
    const connection = sampleConnection();
    const { fixture, fake } = await setup([connection]);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await fixture.componentInstance.deleteConnection(
      connection.id,
      new Event("click"),
    );

    expect(fake.delete).toHaveBeenCalledWith(connection.id);
  });

  it("does not delete when the confirmation is declined", async () => {
    const connection = sampleConnection();
    const { fixture, fake } = await setup([connection]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await fixture.componentInstance.deleteConnection(
      connection.id,
      new Event("click"),
    );

    expect(fake.delete).not.toHaveBeenCalled();
  });
});
