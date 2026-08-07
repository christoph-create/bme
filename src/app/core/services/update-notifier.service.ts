import { Injectable, NgZone, inject, signal } from "@angular/core";

import { AvailableRelease } from "../models/update-check.model";
import { LoggerService } from "./logger.service";
import { UpdateAnnouncement, announcementFor } from "./update-announcement";
import { UpdateService } from "./update.service";

/**
 * Long enough that the first paint never queues behind a network call, short
 * enough that the dialog lands while the user is still looking at the app.
 */
const STARTUP_CHECK_DELAY_MS = 3_000;

/**
 * Holds the "there's a newer bme" state for the whole app, and runs the one
 * automatic check per launch.
 *
 * The automatic check is deliberately silent about everything except a newer,
 * unskipped version: no toast, no badge, and a failure produces a log line and
 * nothing else. The backend's own daily throttle means launching the app ten
 * times a day still only asks GitHub once.
 */
@Injectable({ providedIn: "root" })
export class UpdateNotifierService {
  private readonly updates = inject(UpdateService);
  private readonly logger = inject(LoggerService);
  private readonly zone = inject(NgZone);

  /** The release the dialog is currently offering, if any. */
  readonly available = signal<AvailableRelease | null>(null);
  readonly currentVersion = signal("");

  constructor() {
    void this.loadCurrentVersion();

    // Fire-and-forget and delayed, outside the zone like HeartbeatService:
    // `provideAppInitializer` blocks bootstrap on any promise handed back to
    // it, and nothing here is worth delaying the first paint for.
    this.zone.runOutsideAngular(() => {
      setTimeout(() => void this.checkOnStartup(), STARTUP_CHECK_DELAY_MS);
    });
  }

  /** Never throws and never surfaces an error - a failed startup check is a
   *  log line, not something to interrupt anyone with. */
  private async checkOnStartup(): Promise<void> {
    try {
      const announcement = announcementFor(await this.updates.check(false), false);
      if (announcement.kind === "update") {
        this.zone.run(() => this.available.set(announcement.release));
      }
    } catch (err) {
      this.logger.debug(`update check failed: ${message(err)}`);
    }
  }

  /** Rethrows on failure: the caller owns the error UI, because the user is
   *  standing there waiting for an answer. */
  async checkManually(): Promise<UpdateAnnouncement> {
    const announcement = announcementFor(await this.updates.check(true), true);
    if (announcement.kind === "update") {
      this.available.set(announcement.release);
    }
    return announcement;
  }

  dismiss(): void {
    this.available.set(null);
  }

  async skip(): Promise<void> {
    const release = this.available();
    if (!release) return;

    // Closed before the await: the click already expressed the decision, and a
    // failed write shouldn't leave the dialog hanging open.
    this.available.set(null);
    try {
      await this.updates.skip(release.version);
    } catch (err) {
      this.logger.warn(`could not persist the skipped version: ${message(err)}`);
    }
  }

  private async loadCurrentVersion(): Promise<void> {
    try {
      this.currentVersion.set(await this.updates.getAppVersion());
    } catch (err) {
      // No Tauri bridge (tests, or a plain browser dev server). Same
      // treatment as LoggerService: drop it rather than let it surface.
      this.logger.debug(`could not read the app version: ${message(err)}`);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
