import { Component, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { colorForConnectionId } from "./connection-color";

@Component({
  selector: "app-connections",
  imports: [RouterLink],
  templateUrl: "./connections.html",
  styleUrl: "./connections.css",
})
export class Connections {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly router = inject(Router);

  readonly connections = signal<BrokerConnection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly openMenuId = signal<string | null>(null);

  readonly colorForConnectionId = colorForConnectionId;

  constructor() {
    void this.refresh();
  }

  openBroker(id: string): void {
    void this.router.navigate(["/broker", id]);
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === id ? null : id);
  }

  async deleteConnection(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);
    if (!window.confirm("Delete this connection?")) {
      return;
    }
    await this.connectionsService.delete(id);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.connections.set(await this.connectionsService.list());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }
}
