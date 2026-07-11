import { TestBed } from "@angular/core/testing";
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrokerConnection,
  NewBrokerConnection,
} from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { ConnectionForm } from "./connection-form";

const CREATED: BrokerConnection = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Home Assistant",
  host: "homeassistant.local",
  port: 1883,
  client_id: "bme-abcdef",
  username: null,
  password: null,
  use_tls: false,
  keep_alive_secs: 60,
  subscriptions: [],
};

function activatedRouteStub(id: string | null): Partial<ActivatedRoute> {
  return {
    snapshot: {
      paramMap: convertToParamMap(id ? { id } : {}),
    } as ActivatedRoute["snapshot"],
  };
}

async function setup(id: string | null = null) {
  const fake = {
    create: vi.fn().mockResolvedValue(CREATED),
    connect: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [ConnectionForm],
    providers: [
      provideRouter([]),
      { provide: ConnectionsService, useValue: fake },
      { provide: ActivatedRoute, useValue: activatedRouteStub(id) },
    ],
  });

  const fixture = TestBed.createComponent(ConnectionForm);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);

  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, fake, navigate };
}

const VALID_VALUE = {
  name: "Home Assistant",
  host: "homeassistant.local",
  port: "1883",
  clientId: "bme-abcdef",
  keepAliveSecs: "60",
  useTls: false,
  requiresAuth: false,
  username: "",
  password: "",
};

describe("ConnectionForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates, connects, and navigates to the broker workspace on submit", async () => {
    const { fixture, fake, navigate } = await setup();
    const component = fixture.componentInstance;
    component.form.setValue(VALID_VALUE);

    await component.submit();

    expect(fake.create).toHaveBeenCalledWith({
      name: "Home Assistant",
      host: "homeassistant.local",
      port: 1883,
      client_id: "bme-abcdef",
      username: null,
      password: null,
      use_tls: false,
      keep_alive_secs: 60,
      subscriptions: [],
    } satisfies NewBrokerConnection);
    expect(fake.connect).toHaveBeenCalledWith(CREATED.id);
    expect(navigate).toHaveBeenCalledWith(["/broker", CREATED.id]);
  });

  it("does not create a connection when required fields are missing", async () => {
    const { fixture, fake } = await setup();

    await fixture.componentInstance.submit();

    expect(fake.create).not.toHaveBeenCalled();
  });

  it("sends null username/password when authentication is not required", async () => {
    const { fixture, fake } = await setup();
    fixture.componentInstance.form.setValue({
      ...VALID_VALUE,
      requiresAuth: false,
      username: "leftover-user",
      password: "leftover-pass",
    });

    await fixture.componentInstance.submit();

    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({ username: null, password: null }),
    );
  });

  it("sends the typed username/password when authentication is required", async () => {
    const { fixture, fake } = await setup();
    fixture.componentInstance.form.setValue({
      ...VALID_VALUE,
      requiresAuth: true,
      username: "alice",
      password: "hunter2",
    });

    await fixture.componentInstance.submit();

    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({ username: "alice", password: "hunter2" }),
    );
  });

  it("shows a not-supported message in edit mode and never creates", async () => {
    const { fixture, fake } = await setup("some-id");

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Editing isn't supported yet");
    expect(fake.create).not.toHaveBeenCalled();
  });
});
