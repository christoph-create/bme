import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter } from "@angular/router";

import { routes } from "./app.routes";
import { GlobalErrorHandler } from "./core/global-error-handler";
import { HeartbeatService } from "./core/services/heartbeat.service";
import { LoggerService } from "./core/services/logger.service";
import { SettingsService } from "./core/services/settings.service";
import { UpdateNotifierService } from "./core/services/update-notifier.service";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Must stay void-returning: `provideAppInitializer` waits on any promise
    // it's handed, and none of these is worth delaying bootstrap for. The
    // settings load included: consumers run on the defaults until it lands
    // and re-seed from the signal when it does.
    provideAppInitializer(() => {
      inject(HeartbeatService);
      inject(UpdateNotifierService);
      const logger = inject(LoggerService);
      inject(SettingsService)
        .load()
        .catch((err: unknown) =>
          logger.warn(`settings: load failed, using defaults: ${String(err)}`),
        );
    }),
  ],
};
