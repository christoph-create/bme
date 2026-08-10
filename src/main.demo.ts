import { bootstrapApplication } from "@angular/platform-browser";

import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";
import { installDemoBackend } from "./demo/demo-backend";

// Swapped in for `main.ts` by the `demo` build configuration in angular.json,
// so none of `src/demo/` reaches a production bundle. The backend has to be in
// place before bootstrap: services injected during `provideAppInitializer`
// call `invoke()` immediately.
installDemoBackend();

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err),
);
