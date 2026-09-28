import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router } from "@angular/router";
import { filter, map } from "rxjs";

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
 *
 * The gear at the far end is the only way to reach Settings without leaving
 * the workspace, since the bar is the one piece of chrome that stays put.
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

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly onSettings = computed(() => this.url().startsWith("/settings"));
  // "No workspace showing" covers the settings page too, which has its own
  // button - so home only lights up for the remaining case, the broker list.
  readonly homeActive = computed(
    () => this.activeId() === null && !this.onSettings(),
  );

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

  goSettings(): void {
    void this.router.navigate(["/settings"]);
  }
}
