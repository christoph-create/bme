import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { openUrl } from "@tauri-apps/plugin-opener";

import { UpdateNotifierService } from "./core/services/update-notifier.service";
import { UpdateDialog } from "./shared/update-dialog/update-dialog";

@Component({
  selector: "app-root",
  imports: [RouterOutlet, UpdateDialog],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  // The update dialog lives here rather than on a page because it has to be
  // able to appear over whatever route the user happens to be on.
  readonly notifier = inject(UpdateNotifierService);

  openRelease(url: string): void {
    void openUrl(url);
    this.notifier.dismiss();
  }
}
