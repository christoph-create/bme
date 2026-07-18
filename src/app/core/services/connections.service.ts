import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  BrokerConnection,
  NewBrokerConnection,
  UpdateBrokerConnection,
} from "../models/broker-connection.model";

@Injectable({ providedIn: "root" })
export class ConnectionsService {
  list(): Promise<BrokerConnection[]> {
    return invoke("list_connections");
  }

  get(id: string): Promise<BrokerConnection | null> {
    return invoke("get_connection", { id });
  }

  create(newConnection: NewBrokerConnection): Promise<BrokerConnection> {
    return invoke("create_connection", { newConnection });
  }

  update(id: string, update: UpdateBrokerConnection): Promise<BrokerConnection> {
    return invoke("update_connection", { id, update });
  }

  delete(id: string): Promise<void> {
    return invoke("delete_connection", { id });
  }

  connect(id: string): Promise<void> {
    return invoke("connect_broker", { id });
  }

  disconnect(id: string): Promise<void> {
    return invoke("disconnect_broker", { id });
  }

  /** Kicks off a connection attempt for form data that hasn't been saved
   * yet, returning a throwaway id to watch for Connected/Disconnected
   * events on. Clean up with `disconnect()` once you're done with it. */
  testConnection(newConnection: NewBrokerConnection): Promise<string> {
    return invoke("test_connection", { connection: newConnection });
  }
}
