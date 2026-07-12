import { TestBed } from "@angular/core/testing";
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrokerConnection,
  NewBrokerConnection,
} from "../../core/models/broker-connection.model";
import { MqttEvent } from "../../core/models/mqtt-event.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
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

const TEST_ID = "33333333-3333-3333-3333-333333333333";

function activatedRouteStub(id: string | null): Partial<ActivatedRoute> {
  return {
    snapshot: {
      paramMap: convertToParamMap(id ? { id } : {}),
    } as ActivatedRoute["snapshot"],
  };
}

async function setup(
  id: string | null = null,
  overrides: {
    events$?: Subject<MqttEvent>;
    testConnection?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const events$ = overrides.events$ ?? new Subject<MqttEvent>();
  const fake = {
    create: vi.fn().mockResolvedValue(CREATED),
    connect: vi.fn().mockResolvedValue(undefined),
    testConnection: overrides.testConnection ?? vi.fn().mockResolvedValue(TEST_ID),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [ConnectionForm],
    providers: [
      provideRouter([]),
      { provide: ConnectionsService, useValue: fake },
      { provide: MqttEventsService, useValue: { events$ } },
      { provide: ActivatedRoute, useValue: activatedRouteStub(id) },
    ],
  });

  const fixture = TestBed.createComponent(ConnectionForm);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);

  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, fake, navigate, events$ };
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

  it("creates and navigates to the broker workspace on submit, without connecting itself", async () => {
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
    // BrokerWorkspace connects on mount - connecting here too would race
    // it (see connection-form.ts).
    expect(fake.connect).not.toHaveBeenCalled();
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

  describe("testConnection", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not test when the host/port fields are invalid", async () => {
      const { fixture, fake } = await setup();

      await fixture.componentInstance.testConnection();

      expect(fake.testConnection).not.toHaveBeenCalled();
    });

    it("shows success when the broker connects, and cleans up the ephemeral connection", async () => {
      const { fixture, fake, events$ } = await setup();
      fixture.componentInstance.form.setValue(VALID_VALUE);

      const testPromise = fixture.componentInstance.testConnection();
      // Let the mocked testConnection() promise resolve and the component
      // subscribe to events$ before pushing an event at it - Subjects drop
      // emissions nobody's listening for yet.
      await Promise.resolve();
      events$.next({ Connected: { connection_id: TEST_ID } });
      await testPromise;

      expect(fake.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "homeassistant.local",
          port: 1883,
        }),
      );
      expect(fixture.componentInstance.testStatus()).toBe("success");
      expect(fake.disconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it("does not miss a Connected event that arrives before the ephemeral id is known back (fast/local broker)", async () => {
      // Regression test: a fast broker can reply before the frontend even
      // learns the ephemeral id it needs to filter events by - simulated
      // here by having the mocked testConnection() push the event as part
      // of resolving, i.e. before the caller has the id back at all.
      const events$ = new Subject<MqttEvent>();
      const testConnection = vi.fn().mockImplementation(async () => {
        events$.next({ Connected: { connection_id: TEST_ID } });
        return TEST_ID;
      });
      const { fixture } = await setup(null, { events$, testConnection });
      fixture.componentInstance.form.setValue(VALID_VALUE);

      await fixture.componentInstance.testConnection();

      expect(fixture.componentInstance.testStatus()).toBe("success");
    });

    it("shows an error when the broker reports it disconnected", async () => {
      const { fixture, fake, events$ } = await setup();
      fixture.componentInstance.form.setValue(VALID_VALUE);

      const testPromise = fixture.componentInstance.testConnection();
      await Promise.resolve();
      events$.next({ Disconnected: { connection_id: TEST_ID } });
      await testPromise;

      expect(fixture.componentInstance.testStatus()).toBe("error");
      expect(fixture.componentInstance.testError()).toBeTruthy();
      expect(fake.disconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it("shows a timeout error if nothing responds in time, and still cleans up", async () => {
      vi.useFakeTimers();
      const { fixture, fake } = await setup();
      fixture.componentInstance.form.setValue(VALID_VALUE);

      const testPromise = fixture.componentInstance.testConnection();
      await vi.advanceTimersByTimeAsync(10_000);
      await testPromise;

      expect(fixture.componentInstance.testStatus()).toBe("error");
      expect(fixture.componentInstance.testError()).toContain("Timed out");
      expect(fake.disconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it("ignores events for other connection ids", async () => {
      const { fixture, events$ } = await setup();
      fixture.componentInstance.form.setValue(VALID_VALUE);

      const testPromise = fixture.componentInstance.testConnection();
      await Promise.resolve();
      events$.next({ Connected: { connection_id: "some-other-id" } });
      fixture.detectChanges();

      expect(fixture.componentInstance.testStatus()).toBe("testing");

      events$.next({ Connected: { connection_id: TEST_ID } });
      await testPromise;

      expect(fixture.componentInstance.testStatus()).toBe("success");
    });

    it("resets to idle when the form is edited after a test result", async () => {
      const { fixture, events$ } = await setup();
      fixture.componentInstance.form.setValue(VALID_VALUE);

      const testPromise = fixture.componentInstance.testConnection();
      await Promise.resolve();
      events$.next({ Connected: { connection_id: TEST_ID } });
      await testPromise;
      expect(fixture.componentInstance.testStatus()).toBe("success");

      fixture.componentInstance.form.controls.host.setValue("other.example.com");

      expect(fixture.componentInstance.testStatus()).toBe("idle");
      expect(fixture.componentInstance.testError()).toBeNull();
    });

    it("does not reset a test that's still in flight", async () => {
      const { fixture, events$ } = await setup();
      fixture.componentInstance.form.setValue(VALID_VALUE);

      const testPromise = fixture.componentInstance.testConnection();
      await Promise.resolve();
      expect(fixture.componentInstance.testStatus()).toBe("testing");

      fixture.componentInstance.form.controls.name.setValue("Renamed");

      expect(fixture.componentInstance.testStatus()).toBe("testing");

      // Let the still-pending test settle so it doesn't leak into other tests.
      events$.next({ Connected: { connection_id: TEST_ID } });
      await testPromise;
    });
  });
});
