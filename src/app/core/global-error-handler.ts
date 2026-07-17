import { ErrorHandler, Injectable, inject } from "@angular/core";

import { LoggerService } from "./services/logger.service";

/**
 * Routes every uncaught error - Angular-internal (template bindings, change
 * detection) and, via `provideBrowserGlobalErrorListeners()` in
 * `app.config.ts`, global `window.onerror`/`unhandledrejection` too - into
 * the shared log file, so a freeze investigation can see whether an
 * uncaught JS error preceded it.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly logger = inject(LoggerService);

  handleError(error: unknown): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.logger.error(`uncaught error: ${message}`);
    console.error(error);
  }
}
