import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../models/broker-connection.model";
import { ConnectionsService } from "./connections.service";
import { MessageStoreService } from "./message-store.service";
import { ValueChartsService } from "./value-charts.service";
import { WorkspacesService } from "./workspaces.service";

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const C = "cccccccc-3333-3333-3333-333333333333";

function connection(id: string, name: string): BrokerConnection {
  return {
    id,
    name,
    host: "localhost",
    port: 1883,
    client_id: "bme",
    username: null,
    password: null,
    scheme: "mqtt",
    ws_path: null,
    ca_cert_path: null,
    client_cert_path: null,
    client_key_path: null,
    alpn: null,
    skip_cert_verification: false,
    keep_alive_secs: 30,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
  };
}

function setup(get = vi.fn().mockResolvedValue(null)) {
  const clear = vi.fn();
  const removeAllFor = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      { provide: ConnectionsService, useValue: { get } },
      { provide: MessageStoreService, useValue: { clear } },
      { provide: ValueChartsService, useValue: { removeAllFor } },
    ],
  });

  return {
    service: TestBed.inject(WorkspacesService),
    get,
    clear,
    removeAllFor,
  };
}

describe("WorkspacesService", () => {
  it("starts with nothing open", () => {
    const { service } = setup();

    expect(service.openIds()).toEqual([]);
    expect(service.activeId()).toBeNull();
    expect(service.hasOpenWorkspaces()).toBe(false);
  });

  it("opens a tab and shows it", () => {
    const { service } = setup();

    service.open(A);

    expect(service.openIds()).toEqual([A]);
    expect(service.activeId()).toBe(A);
  });

  it("reopening a tab shows it again without duplicating it", () => {
    const { service } = setup();
    service.open(A);
    service.open(B);

    service.open(A);

    expect(service.openIds()).toEqual([A, B]);
    expect(service.activeId()).toBe(A);
  });

  it("fetches each broker's record once, when its tab opens", async () => {
    const get = vi.fn().mockResolvedValue(connection(A, "Home"));
    const { service } = setup(get);

    service.open(A);
    await Promise.resolve();
    service.open(B);
    service.open(A);

    expect(get).toHaveBeenCalledTimes(2);
    expect(service.connectionFor(A)?.name).toBe("Home");
  });

  it("has no record for a broker whose fetch failed", async () => {
    const get = vi.fn().mockRejectedValue(new Error("gone"));
    const { service } = setup(get);

    service.open(A);
    await Promise.resolve();

    expect(service.connectionFor(A)).toBeNull();
  });

  it("hides every workspace without closing any", () => {
    const { service } = setup();
    service.open(A);

    service.deactivate();

    expect(service.activeId()).toBeNull();
    expect(service.openIds()).toEqual([A]);
  });

  it("closing the active tab activates its neighbour", () => {
    const { service } = setup();
    [A, B, C].forEach((id) => service.open(id));
    service.open(B);

    const next = service.close(B);

    expect(next).toBe(C);
    expect(service.activeId()).toBe(C);
    expect(service.openIds()).toEqual([A, C]);
  });

  it("closing the last tab leaves nothing to show", () => {
    const { service } = setup();
    service.open(A);

    expect(service.close(A)).toBeNull();
    expect(service.openIds()).toEqual([]);
    expect(service.hasOpenWorkspaces()).toBe(false);
  });

  it("closing a background tab leaves the active one alone", () => {
    const { service } = setup();
    service.open(A);
    service.open(B);

    expect(service.close(A)).toBe(B);
    expect(service.activeId()).toBe(B);
  });

  it("closing a tab that was never open changes nothing", () => {
    const { service } = setup();
    service.open(A);

    expect(service.close(C)).toBe(A);
    expect(service.openIds()).toEqual([A]);
  });

  /** Nothing about a workspace is persisted, so a closed tab must not leave
   * its session history or charts behind to accumulate. */
  it("drops the closed broker's history and charts", () => {
    const { service, clear, removeAllFor } = setup();
    service.open(A);

    service.close(A);

    expect(clear).toHaveBeenCalledWith(A);
    expect(removeAllFor).toHaveBeenCalledWith(A);
  });

  it("forgets a broker's record when its tab closes", async () => {
    const get = vi.fn().mockResolvedValue(connection(A, "Home"));
    const { service } = setup(get);
    service.open(A);
    await Promise.resolve();

    service.close(A);

    expect(service.connectionFor(A)).toBeNull();
  });
});
