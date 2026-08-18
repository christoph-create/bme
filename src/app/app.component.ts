import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { openUrl } from "@tauri-apps/plugin-opener";

import { UpdateNotifierService } from "./core/services/update-notifier.service";
import { WorkspacesService } from "./core/services/workspaces.service";
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

  openRelease(url: string): void {
    void openUrl(url);
    this.notifier.dismiss();
  }
}
