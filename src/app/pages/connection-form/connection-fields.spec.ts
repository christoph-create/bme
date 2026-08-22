import { describe, expect, it } from "vitest";
import { BrokerConnection } from "../../core/models/broker-connection.model";
import {
  connectionToFormValue,
  ConnectionFormValue,
  formValueToConnection,
} from "./connection-fields";

const FORM_VALUE: ConnectionFormValue = {
  name: "Home Assistant",
  scheme: "mqtt",
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

const CONNECTION: BrokerConnection = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "AWS IoT",
  host: "a1b2c3.iot.eu-central-1.amazonaws.com",
  port: 8884,
  client_id: "bme-17iecb",
  username: null,
  password: null,
  scheme: "wss",
  ws_path: "/mqtt",
  ca_cert_path: "/certs/AmazonRootCA1.pem",
  client_cert_path: "/certs/device-01-cert.pem",
  client_key_path: "/certs/device-01-key.pem",
  alpn: "x-amzn-mqtt-ca",
  skip_cert_verification: false,
  keep_alive_secs: 60,
  auto_reconnect: true,
  max_reconnect_attempts: 10,
  subscriptions: [],
};

describe("formValueToConnection", () => {
  it("converts the text-held numbers", () => {
    const connection = formValueToConnection(FORM_VALUE);

    expect(connection.port).toBe(1883);
    expect(connection.keep_alive_secs).toBe(60);
    expect(connection.max_reconnect_attempts).toBe(10);
  });

  // The backend takes Option<String>, where "" and null mean different things.
  it("sends blank optional fields as null rather than empty strings", () => {
    const connection = formValueToConnection(FORM_VALUE);

    expect(connection.ws_path).toBe(null);
    expect(connection.ca_cert_path).toBe(null);
    expect(connection.client_cert_path).toBe(null);
    expect(connection.client_key_path).toBe(null);
    expect(connection.alpn).toBe(null);
  });

  it("keeps the certificate paths and ALPN it was given", () => {
    const connection = formValueToConnection({
      ...FORM_VALUE,
      scheme: "wss",
      caCertPath: "/certs/AmazonRootCA1.pem",
      clientCertPath: "/certs/device-cert.pem",
      clientKeyPath: "/certs/device-key.pem",
      alpn: " x-amzn-mqtt-ca ",
      skipCertVerification: true,
    });

    expect(connection.ca_cert_path).toBe("/certs/AmazonRootCA1.pem");
    expect(connection.client_cert_path).toBe("/certs/device-cert.pem");
    expect(connection.client_key_path).toBe("/certs/device-key.pem");
    expect(connection.alpn).toBe("x-amzn-mqtt-ca");
    expect(connection.skip_cert_verification).toBe(true);
  });

  // The path input stays filled while you flip between schemes to compare
  // them; only what gets saved is scheme-dependent.
  it("drops the path on the schemes that have no path", () => {
    expect(
      formValueToConnection({ ...FORM_VALUE, scheme: "mqtts", wsPath: "/mqtt" })
        .ws_path,
    ).toBe(null);
    expect(
      formValueToConnection({ ...FORM_VALUE, scheme: "wss", wsPath: "/mqtt" })
        .ws_path,
    ).toBe("/mqtt");
  });

  it("only sends credentials when authentication is switched on", () => {
    const withoutAuth = formValueToConnection({
      ...FORM_VALUE,
      username: "alice",
      password: "hunter2",
    });
    expect(withoutAuth.username).toBe(null);
    expect(withoutAuth.password).toBe(null);

    const withAuth = formValueToConnection({
      ...FORM_VALUE,
      requiresAuth: true,
      username: "alice",
      password: "hunter2",
    });
    expect(withAuth.username).toBe("alice");
    expect(withAuth.password).toBe("hunter2");
  });
});

describe("connectionToFormValue", () => {
  it("fills every control, including the ones that were null", () => {
    const value = connectionToFormValue(CONNECTION);

    expect(value).toEqual({
      name: "AWS IoT",
      scheme: "wss",
      host: "a1b2c3.iot.eu-central-1.amazonaws.com",
      port: "8884",
      wsPath: "/mqtt",
      clientId: "bme-17iecb",
      keepAliveSecs: "60",
      autoReconnect: true,
      maxReconnectAttempts: "10",
      requiresAuth: false,
      username: "",
      password: "",
      caCertPath: "/certs/AmazonRootCA1.pem",
      clientCertPath: "/certs/device-01-cert.pem",
      clientKeyPath: "/certs/device-01-key.pem",
      alpn: "x-amzn-mqtt-ca",
      skipCertVerification: false,
    } satisfies ConnectionFormValue);
  });

  it("switches authentication on for a connection that has a username", () => {
    const value = connectionToFormValue({
      ...CONNECTION,
      username: "alice",
      password: "hunter2",
    });

    expect(value.requiresAuth).toBe(true);
    expect(value.username).toBe("alice");
  });

  it("round-trips back to the same connection fields", () => {
    const { id, subscriptions, ...fields } = CONNECTION;
    void id;
    void subscriptions;

    expect(formValueToConnection(connectionToFormValue(CONNECTION))).toEqual(
      fields,
    );
  });
});
