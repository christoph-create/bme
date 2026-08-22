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

// The file picker is a Tauri plugin, so there is no runtime for it here. The
// tests that care drive its return value; the rest just need it not to throw.
const openDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));

const CREATED: BrokerConnection = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Home Assistant",
  host: "homeassistant.local",
  port: 1883,
  client_id: "bme-abcdef",
  username: null,
  password: null,
  scheme: "mqtt",
  ws_path: null,
  ca_cert_path: null,
  client_cert_path: null,
  client_key_path: null,
  alpn: null,
  skip_cert_verification: false,
  keep_alive_secs: 60,
  auto_reconnect: true,
  max_reconnect_attempts: 10,
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
    get?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const events$ = overrides.events$ ?? new Subject<MqttEvent>();
  const fake = {
    create: vi.fn().mockResolvedValue(CREATED),
    update: overrides.update ?? vi.fn().mockResolvedValue(CREATED),
    get: overrides.get ?? vi.fn().mockResolvedValue(CREATED),
    connect: vi.fn().mockResolvedValue(undefined),
    testConnection:
      overrides.testConnection ?? vi.fn().mockResolvedValue(TEST_ID),
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
  scheme: "mqtt" as const,
  host: "homeassistant.local",
  port: "1883",
  wsPath: "",
  clientId: "bme-abcdef",
  keepAliveSecs: "60",
  autoReconnect: true,
  maxReconnectAttempts: "10",
  requiresAuth: false,
  username: "",
  password: "",
  caCertPath: "",
  clientCertPath: "",
  clientKeyPath: "",
  alpn: "",
  skipCertVerification: false,
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
      scheme: "mqtt",
      ws_path: null,
      ca_cert_path: null,
      client_cert_path: null,
      client_key_path: null,
      alpn: null,
      skip_cert_verification: false,
      keep_alive_secs: 60,
      auto_reconnect: true,
      max_reconnect_attempts: 10,
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

  describe("scheme and certificates", () => {
    it("moves the port to the new scheme's default", async () => {
      const { fixture } = await setup();
      const form = fixture.componentInstance.form;

      form.controls.scheme.setValue("wss");

      expect(form.controls.port.value).toBe("8084");
    });

    // The port following the scheme is a convenience, not a rule - taking a
    // deliberately typed port away again would be the more annoying half.
    it("leaves a hand-typed port alone", async () => {
      const { fixture } = await setup();
      const form = fixture.componentInstance.form;
      form.controls.port.setValue("18883");

      form.controls.scheme.setValue("mqtts");

      expect(form.controls.port.value).toBe("18883");
    });

    /// The switch is 32x18; the banner it sits in is the width of the column.
    /// Labelling the whole banner is what makes the setting reachable without
    /// aiming, and the accessible name has to survive it - the hint mentions
    /// "hostname", which would otherwise make every by-label lookup for the
    /// Host field ambiguous.
    it("toggles from anywhere in the warning banner, and keeps its name", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.scheme.setValue("mqtts");
      fixture.detectChanges();

      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        ".danger-panel",
      ) as HTMLLabelElement;
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        "#skipCertVerification",
      ) as HTMLInputElement;

      expect(panel.tagName).toBe("LABEL");
      expect(panel.htmlFor).toBe("skipCertVerification");
      expect(input.getAttribute("aria-labelledby")).toBe(
        "skipCertVerificationTitle",
      );

      // What a click on the banner's own area resolves to.
      panel.click();
      fixture.detectChanges();

      expect(input.checked).toBe(true);
      expect(component.form.controls.skipCertVerification.value).toBe(true);
      expect(panel.classList.contains("armed")).toBe(true);
    });

    it("fills a certificate path from the picker and can clear it again", async () => {
      openDialog.mockResolvedValue("/home/me/certs/AmazonRootCA1.pem");
      const { fixture } = await setup();
      const component = fixture.componentInstance;

      await component.pickCertificate("caCertPath");

      expect(component.form.controls.caCertPath.value).toBe(
        "/home/me/certs/AmazonRootCA1.pem",
      );
      expect(component.caCertName()).toBe("AmazonRootCA1.pem");

      component.clearCertificate("caCertPath");

      expect(component.form.controls.caCertPath.value).toBe("");
      expect(component.caCertName()).toBe(null);
    });

    it("keeps the existing path when the picker is dismissed", async () => {
      openDialog.mockResolvedValue(null);
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.clientKeyPath.setValue("/certs/device.key");

      await component.pickCertificate("clientKeyPath");

      expect(component.form.controls.clientKeyPath.value).toBe(
        "/certs/device.key",
      );
    });

    it("saves a cleared certificate as null rather than an empty path", async () => {
      const { fixture, fake } = await setup();
      const component = fixture.componentInstance;
      component.form.setValue({
        ...VALID_VALUE,
        scheme: "mqtts",
        caCertPath: "/certs/ca.pem",
      });

      component.clearCertificate("caCertPath");
      await component.submit();

      expect(fake.create).toHaveBeenCalledWith(
        expect.objectContaining({ ca_cert_path: null }),
      );
    });
  });

  describe("edit mode", () => {
    it("loads and prefills the existing connection", async () => {
      const get = vi.fn().mockResolvedValue(CREATED);
      const { fixture } = await setup(CREATED.id, { get });

      expect(get).toHaveBeenCalledWith(CREATED.id);
      expect(fixture.componentInstance.loading()).toBe(false);
      expect(fixture.componentInstance.form.getRawValue()).toEqual({
        name: CREATED.name,
        scheme: CREATED.scheme,
        host: CREATED.host,
        port: String(CREATED.port),
        wsPath: "",
        clientId: CREATED.client_id,
        keepAliveSecs: String(CREATED.keep_alive_secs),
        autoReconnect: CREATED.auto_reconnect,
        maxReconnectAttempts: String(CREATED.max_reconnect_attempts),
        requiresAuth: false,
        username: "",
        password: "",
        caCertPath: "",
        clientCertPath: "",
        clientKeyPath: "",
        alpn: "",
        skipCertVerification: false,
      });
    });

    it("prefills the reconnect settings of a connection that has them switched off", async () => {
      const withoutReconnect: BrokerConnection = {
        ...CREATED,
        auto_reconnect: false,
        max_reconnect_attempts: 3,
      };
      const { fixture } = await setup(CREATED.id, {
        get: vi.fn().mockResolvedValue(withoutReconnect),
      });

      const value = fixture.componentInstance.form.getRawValue();
      expect(value.autoReconnect).toBe(false);
      expect(value.maxReconnectAttempts).toBe("3");
    });

    it("prefills credentials and checks 'requires authentication' when a username is stored", async () => {
      const withAuth: BrokerConnection = {
        ...CREATED,
        username: "alice",
        password: "hunter2",
      };
      const { fixture } = await setup(CREATED.id, {
        get: vi.fn().mockResolvedValue(withAuth),
      });

      const value = fixture.componentInstance.form.getRawValue();
      expect(value.requiresAuth).toBe(true);
      expect(value.username).toBe("alice");
      expect(value.password).toBe("hunter2");
    });

    it("shows an error and never updates when the connection is not found", async () => {
      const { fixture, fake } = await setup(CREATED.id, {
        get: vi.fn().mockResolvedValue(null),
      });

      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("Connection not found");
      expect(fake.update).not.toHaveBeenCalled();
    });

    it("updates the connection and navigates back to the connections list on submit", async () => {
      const { fixture, fake, navigate } = await setup(CREATED.id);

      await fixture.componentInstance.submit();

      expect(fake.update).toHaveBeenCalledWith(CREATED.id, {
        name: CREATED.name,
        host: CREATED.host,
        port: CREATED.port,
        client_id: CREATED.client_id,
        username: null,
        password: null,
        scheme: CREATED.scheme,
        ws_path: null,
        ca_cert_path: null,
        client_cert_path: null,
        client_key_path: null,
        alpn: null,
        skip_cert_verification: false,
        keep_alive_secs: CREATED.keep_alive_secs,
        auto_reconnect: CREATED.auto_reconnect,
        max_reconnect_attempts: CREATED.max_reconnect_attempts,
      });
      expect(fake.create).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(["/connections"]);
    });
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

      fixture.componentInstance.form.controls.host.setValue(
        "other.example.com",
      );

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
