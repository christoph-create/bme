import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  BrokerConnection,
  NewBrokerConnection,
} from "../models/broker-connection.model";

@Injectable({ providedIn: "root" })
export class ConnectionsService {
  list(): Promise<BrokerConnection[]> {
    return invoke("list_connections");
  }

  create(newConnection: NewBrokerConnection): Promise<BrokerConnection> {
    return invoke("create_connection", { newConnection });
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
}
