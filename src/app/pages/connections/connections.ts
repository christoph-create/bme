import { Component, HostListener, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { invoke } from "@tauri-apps/api/core";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";

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

  constructor() {
    void this.refresh();
  }

  openBroker(id: string): void {
    void this.router.navigate(["/broker", id]);
  }

  openLogDir(): void {
    void invoke("open_log_dir");
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === id ? null : id);
  }

  /** Closes the "⋯" menu on any click that isn't handled (and stopped) by the menu itself. */
  @HostListener("document:click")
  closeMenu(): void {
    this.openMenuId.set(null);
  }

  async deleteConnection(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);
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
