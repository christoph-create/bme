import { Injectable, NgZone, inject } from "@angular/core";

import { LoggerService } from "./logger.service";

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Logs a periodic "still alive" tick. A freeze produces no log output on
 * its own, so this exists purely to make the *gap* visible afterwards: if
 * the last heartbeat is at T and nothing follows until the app is force-quit,
 * the main thread stopped responding at ~T - which, read against the
 * backend's message-received log lines, narrows down whether a given
 * message's processing is what froze the UI.
 */
@Injectable({ providedIn: "root" })
export class HeartbeatService {
  private readonly logger = inject(LoggerService);
  private readonly zone = inject(NgZone);
  private tickCount = 0;

  constructor() {
    this.zone.runOutsideAngular(() => {
      setInterval(() => {
        this.tickCount++;
        this.logger.debug(`heartbeat #${this.tickCount}`);
      }, HEARTBEAT_INTERVAL_MS);
    });
  }
}
