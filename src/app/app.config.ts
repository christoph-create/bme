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
import { UpdateNotifierService } from "./core/services/update-notifier.service";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Must stay void-returning: `provideAppInitializer` waits on any promise
    // it's handed, and neither of these is worth delaying bootstrap for.
    provideAppInitializer(() => {
      inject(HeartbeatService);
      inject(UpdateNotifierService);
    }),
  ],
};
