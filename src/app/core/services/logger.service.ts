import { Injectable } from "@angular/core";
import * as pluginLog from "@tauri-apps/plugin-log";

/**
 * Thin wrapper around `@tauri-apps/plugin-log`, which relays calls over
 * Tauri IPC into the same Rust-side logger/file the backend writes to - so
 * frontend and backend log lines land in one correlated timeline. Calls are
 * fire-and-forget: logging must never make a caller wait on an IPC round
 * trip.
 */
@Injectable({ providedIn: "root" })
export class LoggerService {
  trace(message: string): void {
    this.call(pluginLog.trace(message));
  }

  debug(message: string): void {
    this.call(pluginLog.debug(message));
  }

  info(message: string): void {
    this.call(pluginLog.info(message));
  }

  warn(message: string): void {
    this.call(pluginLog.warn(message));
  }

  error(message: string): void {
    this.call(pluginLog.error(message));
  }

  // If there's no Tauri IPC bridge available (e.g. running outside the
  // Tauri webview, or in tests), there's nothing to recover into - just
  // drop the log line rather than letting it surface as an unhandled
  // promise rejection.
  private call(result: Promise<void>): void {
    result.catch(() => undefined);
  }
}
