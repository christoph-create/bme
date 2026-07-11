import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../../../core/models/broker-connection.model";
import { ConnectionsService } from "../../../core/services/connections.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { SubscriptionsPanel } from "./subscriptions-panel";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function sampleConnection(
  overrides: Partial<BrokerConnection> = {},
): BrokerConnection {
  return {
    id: CONNECTION_ID,
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

async function setup(connection: BrokerConnection) {
  const connectionsService = {
    get: vi.fn().mockResolvedValue(connection),
  };
  const mqttService = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [SubscriptionsPanel],
    providers: [
      { provide: ConnectionsService, useValue: connectionsService },
      { provide: MqttService, useValue: mqttService },
    ],
  });

  const fixture = TestBed.createComponent(SubscriptionsPanel);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, connectionsService, mqttService };
}

describe("SubscriptionsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the connection's current subscriptions", async () => {
    const connection = sampleConnection({
      subscriptions: [
        {
          id: "s1",
          connection_id: CONNECTION_ID,
          topic: "sensors/#",
          qos: "AtLeastOnce",
        },
      ],
    });
    const { fixture } = await setup(connection);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("sensors/#");
    expect(text).toContain("Q1");
  });

  it("subscribes to a new topic and adds it to the list", async () => {
    const { fixture, mqttService } = await setup(sampleConnection());
    const created = {
      id: "s2",
      connection_id: CONNECTION_ID,
      topic: "home/#",
      qos: "AtMostOnce",
    };
    mqttService.subscribe.mockResolvedValue(created);

    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("home/#");
    await component.subscribe();

    expect(mqttService.subscribe).toHaveBeenCalledWith(
      CONNECTION_ID,
      "home/#",
      "AtMostOnce",
    );
    expect(component.subscriptions()).toContainEqual(created);
  });

  it("does not subscribe when the topic field is empty", async () => {
    const { fixture, mqttService } = await setup(sampleConnection());

    await fixture.componentInstance.subscribe();

    expect(mqttService.subscribe).not.toHaveBeenCalled();
  });

  it("selecting a QoS segment changes the QoS used to subscribe", async () => {
    const { fixture, mqttService } = await setup(sampleConnection());
    mqttService.subscribe.mockResolvedValue({
      id: "s3",
      connection_id: CONNECTION_ID,
      topic: "device/#",
      qos: "ExactlyOnce",
    });

    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("device/#");
    component.selectQos("ExactlyOnce");
    await component.subscribe();

    expect(mqttService.subscribe).toHaveBeenCalledWith(
      CONNECTION_ID,
      "device/#",
      "ExactlyOnce",
    );
  });

  it("unsubscribes and removes the chip from the list", async () => {
    const subscription = {
      id: "s1",
      connection_id: CONNECTION_ID,
      topic: "sensors/#",
      qos: "AtLeastOnce" as const,
    };
    const { fixture, mqttService } = await setup(
      sampleConnection({ subscriptions: [subscription] }),
    );

    await fixture.componentInstance.unsubscribe(subscription);

    expect(mqttService.unsubscribe).toHaveBeenCalledWith(
      CONNECTION_ID,
      subscription.id,
      subscription.topic,
    );
    expect(fixture.componentInstance.subscriptions()).toEqual([]);
  });
});
