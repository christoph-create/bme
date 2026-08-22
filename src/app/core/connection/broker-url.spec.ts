import { describe, expect, it } from "vitest";
import {
  brokerUrl,
  certificateName,
  defaultPortFor,
  isTls,
  isWebSocket,
  normalizeWsPath,
} from "./broker-url";

describe("brokerUrl", () => {
  it("leaves the path off the TCP schemes, which have none", () => {
    expect(brokerUrl("mqtt", "localhost", 1883)).toBe("mqtt://localhost:1883");
    expect(brokerUrl("mqtts", "mqtt.example.com", 8883)).toBe(
      "mqtts://mqtt.example.com:8883",
    );
  });

  it("appends the default path for the WebSocket schemes", () => {
    expect(brokerUrl("ws", "localhost", 8083)).toBe("ws://localhost:8083/mqtt");
    expect(brokerUrl("wss", "broker.hivemq.cloud", 8884, null)).toBe(
      "wss://broker.hivemq.cloud:8884/mqtt",
    );
  });

  it("uses an explicit path when there is one", () => {
    expect(brokerUrl("wss", "example.com", 443, "/ws/mqtt")).toBe(
      "wss://example.com:443/ws/mqtt",
    );
  });

  // The URL updates as the user types, so it has to read sensibly while the
  // host and port fields are still half-empty rather than showing "undefined"
  // or ":NaN".
  it("stands in for the parts that have not been typed yet", () => {
    expect(brokerUrl("mqtt", "", "")).toBe("mqtt://…:…");
    expect(brokerUrl("mqtt", "localhost", "")).toBe("mqtt://localhost:…");
  });
});

describe("normalizeWsPath", () => {
  it("falls back to the conventional default", () => {
    expect(normalizeWsPath(null)).toBe("/mqtt");
    expect(normalizeWsPath("")).toBe("/mqtt");
    expect(normalizeWsPath("   ")).toBe("/mqtt");
    expect(normalizeWsPath("/")).toBe("/mqtt");
  });

  it("adds the leading slash a hand-typed path usually misses", () => {
    expect(normalizeWsPath("ws")).toBe("/ws");
    expect(normalizeWsPath("/ws")).toBe("/ws");
  });
});

describe("defaultPortFor", () => {
  it("matches BrokerScheme::default_port on the Rust side", () => {
    expect(defaultPortFor("mqtt")).toBe(1883);
    expect(defaultPortFor("mqtts")).toBe(8883);
    expect(defaultPortFor("ws")).toBe(8083);
    expect(defaultPortFor("wss")).toBe(8084);
  });
});

describe("scheme predicates", () => {
  it("splits the schemes the same way the backend does", () => {
    expect(isTls("mqtt")).toBe(false);
    expect(isTls("mqtts")).toBe(true);
    expect(isTls("ws")).toBe(false);
    expect(isTls("wss")).toBe(true);

    expect(isWebSocket("mqtt")).toBe(false);
    expect(isWebSocket("ws")).toBe(true);
    expect(isWebSocket("wss")).toBe(true);
  });
});

describe("certificateName", () => {
  it("shows just the file, since the directory is rarely the interesting part", () => {
    expect(certificateName("/home/me/certs/AmazonRootCA1.pem")).toBe(
      "AmazonRootCA1.pem",
    );
  });

  // A connection exported from a Windows machine keeps its backslashes.
  it("handles Windows paths too", () => {
    expect(certificateName("C:\\certs\\device.pem")).toBe("device.pem");
  });

  it("has nothing to show for an unset path", () => {
    expect(certificateName(null)).toBe(null);
    expect(certificateName("  ")).toBe(null);
  });
});
