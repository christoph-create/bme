import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { WorkspacesService } from "../../core/services/workspaces.service";
import { BrokerWorkspace } from "../../pages/broker-workspace/broker-workspace";

/**
 * Keeps every open workspace mounted, showing only the active one.
 *
 * Hidden rather than destroyed, because a background tab has work in flight: a
 * repeating publisher still firing, a draft half-typed, a topic tree expanded,
 * a stream scrolled to where the user left it. Rebuilding all that on every
 * tab switch is the thing tabs are supposed to avoid.
 */
@Component({
  selector: "app-workspace-host",
  imports: [BrokerWorkspace],
  templateUrl: "./workspace-host.html",
  styleUrl: "./workspace-host.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceHost {
  private readonly workspaces = inject(WorkspacesService);

  readonly openIds = this.workspaces.openIds;
  readonly activeId = this.workspaces.activeId;
}
