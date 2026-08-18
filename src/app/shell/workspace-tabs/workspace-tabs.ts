import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { Router } from "@angular/router";

import { ConnectionStatusService } from "../../core/services/connection-status.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import { StatusDot } from "../../shared/status-dot/status-dot";

/**
 * One tab per open broker workspace, above the workspace's own header.
 *
 * There is deliberately no close button: a tab exists for as long as its
 * session does, and Disconnect is what ends both. That keeps "stop talking to
 * this broker" a single, labelled, deliberate action rather than something you
 * can do by aiming badly at a small ×.
 */
@Component({
  selector: "app-workspace-tabs",
  imports: [StatusDot],
  templateUrl: "./workspace-tabs.html",
  styleUrl: "./workspace-tabs.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceTabs {
  private readonly workspaces = inject(WorkspacesService);
  private readonly status = inject(ConnectionStatusService);
  private readonly router = inject(Router);

  readonly openIds = this.workspaces.openIds;
  readonly activeId = this.workspaces.activeId;

  readonly statusOf = this.status.statusOf.bind(this.status);

  nameOf(connectionId: string): string {
    return this.workspaces.connectionFor(connectionId)?.name ?? "Broker";
  }

  activate(connectionId: string): void {
    void this.router.navigate(["/broker", connectionId]);
  }

  goHome(): void {
    void this.router.navigate(["/connections"]);
  }
}
