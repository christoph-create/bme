import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  BrokerConnection,
  NewBrokerConnection,
  UpdateBrokerConnection,
} from "../models/broker-connection.model";
import { ConnectionsService } from "./connections.service";

const SAMPLE_ID = "11111111-1111-1111-1111-111111111111";

function sampleNewConnection(): NewBrokerConnection {
  return {
    name: "Local",
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

function sampleConnection(): BrokerConnection {
  return { id: SAMPLE_ID, ...sampleNewConnection(), subscriptions: [] };
}

describe("ConnectionsService", () => {
  afterEach(() => {
    clearMocks();
  });

  it("lists connections via the list_connections command", async () => {
    const connections = [sampleConnection()];
    mockIPC((cmd) => {
      if (cmd === "list_connections") return connections;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new ConnectionsService().list()).resolves.toEqual(
      connections,
    );
  });

  it("gets a single connection via the get_connection command", async () => {
    const connection = sampleConnection();
    mockIPC((cmd, args) => {
      if (cmd === "get_connection") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return connection;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new ConnectionsService().get(SAMPLE_ID)).resolves.toEqual(
      connection,
    );
  });

  it("resolves null from get_connection when the connection is not found", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_connection") return null;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().get(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("creates a connection via the create_connection command with camelCased args", async () => {
    const newConnection = sampleNewConnection();
    const created = sampleConnection();
    mockIPC((cmd, args) => {
      if (cmd === "create_connection") {
        expect(args).toEqual({ newConnection });
        return created;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().create(newConnection),
    ).resolves.toEqual(created);
  });

  it("updates a connection via the update_connection command with camelCased args", async () => {
    const update: UpdateBrokerConnection = {
      name: "Renamed",
      host: "renamed.local",
      port: 8883,
      client_id: "bme",
      username: null,
      password: null,
      scheme: "mqtts",
      ws_path: null,
      ca_cert_path: null,
      client_cert_path: null,
      client_key_path: null,
      alpn: null,
      skip_cert_verification: false,
      keep_alive_secs: 45,
      auto_reconnect: false,
      max_reconnect_attempts: 3,
    };
    const updated: BrokerConnection = { ...sampleConnection(), ...update };
    mockIPC((cmd, args) => {
      if (cmd === "update_connection") {
        expect(args).toEqual({ id: SAMPLE_ID, update });
        return updated;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().update(SAMPLE_ID, update),
    ).resolves.toEqual(updated);
  });

  it("deletes a connection via the delete_connection command", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "delete_connection") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().delete(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("connects to a broker via the connect_broker command", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "connect_broker") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().connect(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("disconnects from a broker via the disconnect_broker command", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "disconnect_broker") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().disconnect(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("tests a connection via the test_connection command, returning the ephemeral id", async () => {
    const newConnection = sampleNewConnection();
    mockIPC((cmd, args) => {
      if (cmd === "test_connection") {
        expect(args).toEqual({ connection: newConnection });
        return "22222222-2222-2222-2222-222222222222";
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new ConnectionsService().testConnection(newConnection),
    ).resolves.toBe("22222222-2222-2222-2222-222222222222");
  });

  it("propagates command errors as rejected promises", async () => {
    mockIPC((cmd) => {
      if (cmd === "list_connections") {
        throw new Error("boom");
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new ConnectionsService().list()).rejects.toThrow("boom");
  });
});
