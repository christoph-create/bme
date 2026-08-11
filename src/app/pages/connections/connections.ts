import { Component, HostListener, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { invoke } from "@tauri-apps/api/core";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionStatusService } from "../../core/services/connection-status.service";
import { ConnectionsService } from "../../core/services/connections.service";
import { UpdateNotifierService } from "../../core/services/update-notifier.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import { StatusDot } from "../../shared/status-dot/status-dot";

@Component({
  selector: "app-connections",
  imports: [RouterLink, StatusDot],
  templateUrl: "./connections.html",
  styleUrl: "./connections.css",
})
export class Connections {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly status = inject(ConnectionStatusService);
  private readonly workspaces = inject(WorkspacesService);
  private readonly router = inject(Router);
  readonly notifier = inject(UpdateNotifierService);

  /** Brokers stay connected after you leave their workspace, so this list is
   * the only place that says which ones still are. */
  readonly statusOf = this.status.statusOf.bind(this.status);

  readonly connections = signal<BrokerConnection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly openMenuId = signal<string | null>(null);
  readonly checkingUpdate = signal(false);
  readonly updateStatus = signal<string | null>(null);

  constructor() {
    void this.refresh();
  }

  openBroker(id: string): void {
    void this.router.navigate(["/broker", id]);
  }

  openLogDir(): void {
    void invoke("open_log_dir");
  }

  /** Unlike the automatic check, this one always says something - the user is
   *  standing here waiting for an answer. */
  async checkForUpdates(): Promise<void> {
    if (this.checkingUpdate()) return;
    this.checkingUpdate.set(true);
    this.updateStatus.set(null);
    try {
      const announcement = await this.notifier.checkManually();
      // An available update needs no message here: the notifier has already
      // set `available()`, and the dialog that opens *is* the message.
      this.updateStatus.set(
        announcement.kind === "up-to-date"
          ? "You're on the latest version"
          : null,
      );
    } catch (err) {
      this.updateStatus.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.checkingUpdate.set(false);
    }
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
    // The backend drops the live session as part of the delete, so anything
    // this id left behind is now about a broker that no longer exists.
    this.workspaces.close(id);
    this.status.forget(id);
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
