import { Injectable, effect, inject } from "@angular/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { snapZoom, zoomIn, zoomOut } from "../settings/zoom-levels";
import { LoggerService } from "./logger.service";
import { SettingsService } from "./settings.service";

/**
 * Keeps the webview's zoom in step with the `ui.zoom` setting.
 *
 * Native webview zoom, not a CSS transform: it scales the CSS pixel itself,
 * so every measurement the app makes in pixels - dock sizes, splitter
 * tracks, the virtualised stream's row heights - keeps its meaning and the
 * interface grows as one piece. See `settings/zoom-levels.ts`.
 *
 * Instantiated from `app.config.ts`'s initializer, like the heartbeat and
 * the update notifier; nothing injects it to read from it.
 */
@Injectable({ providedIn: "root" })
export class UiZoomService {
  private readonly settings = inject(SettingsService);
  private readonly logger = inject(LoggerService);

  /** What is currently applied, for the shortcuts to step from. */
  readonly zoom = this.settings.value("uiZoom");

  constructor() {
    effect(() => {
      void this.apply(this.zoom());
    });
  }

  stepIn(): void {
    this.set(zoomIn(this.zoom()));
  }

  stepOut(): void {
    this.set(zoomOut(this.zoom()));
  }

  reset(): void {
    this.set(1);
  }

  private set(zoom: number): void {
    if (zoom === this.zoom()) {
      return;
    }
    void this.settings.set("uiZoom", zoom).catch((err: unknown) => {
      this.logger.warn(`ui zoom: could not save ${zoom}: ${String(err)}`);
    });
  }

  /** Failure is logged, not surfaced: there is no webview to zoom when the
   * UI runs in a plain browser (the demo build), and a zoom that didn't take
   * is not worth interrupting anyone over. */
  private async apply(zoom: number): Promise<void> {
    try {
      await getCurrentWebview().setZoom(snapZoom(zoom));
    } catch (err: unknown) {
      this.logger.warn(`ui zoom: could not apply ${zoom}: ${String(err)}`);
    }
  }
}
