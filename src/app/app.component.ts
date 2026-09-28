import { Component, HostListener, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { openUrl } from "@tauri-apps/plugin-opener";

import { UiZoomService } from "./core/services/ui-zoom.service";
import { UpdateNotifierService } from "./core/services/update-notifier.service";
import { WorkspacesService } from "./core/services/workspaces.service";
import { zoomActionFor } from "./core/settings/zoom-shortcut";
import { UpdateDialog } from "./shared/update-dialog/update-dialog";
import { WorkspaceHost } from "./shell/workspace-host/workspace-host";
import { WorkspaceTabs } from "./shell/workspace-tabs/workspace-tabs";

@Component({
  selector: "app-root",
  imports: [RouterOutlet, UpdateDialog, WorkspaceTabs, WorkspaceHost],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  // The update dialog lives here rather than on a page because it has to be
  // able to appear over whatever route the user happens to be on.
  readonly notifier = inject(UpdateNotifierService);

  // The tab bar rides above every route, so it is here rather than on a page.
  readonly workspaces = inject(WorkspacesService);

  private readonly uiZoom = inject(UiZoomService);

  /** Zoom is app-wide, so the binding is too - it works over any route, and
   * over a modal or a focused editor, the same as it does in a browser.
   * `preventDefault` so the webview cannot also act on it and double-step. */
  @HostListener("document:keydown", ["$event"])
  onKeydown(event: KeyboardEvent): void {
    const action = zoomActionFor(event);
    if (action === null) {
      return;
    }
    event.preventDefault();
    if (action === "in") {
      this.uiZoom.stepIn();
    } else if (action === "out") {
      this.uiZoom.stepOut();
    } else {
      this.uiZoom.reset();
    }
  }

  openRelease(url: string): void {
    void openUrl(url);
    this.notifier.dismiss();
  }
}
