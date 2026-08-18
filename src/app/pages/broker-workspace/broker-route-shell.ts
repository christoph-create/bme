import { Component, DestroyRef, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";

import { WorkspacesService } from "../../core/services/workspaces.service";

/**
 * The `/broker/:id` route, which renders nothing.
 *
 * The workspaces themselves live in `WorkspaceHost`, outside the router
 * outlet, so switching tabs never destroys one. All this route does is point
 * the host at the id in the URL - which keeps deep links, the address bar and
 * the back button working exactly as before.
 *
 * It reads `paramMap` rather than `snapshot`, because Angular reuses this
 * component instance when navigating from one broker id to another.
 */
@Component({
  selector: "app-broker-route-shell",
  template: "",
})
export class BrokerRouteShell {
  constructor() {
    const route = inject(ActivatedRoute);
    const workspaces = inject(WorkspacesService);

    const subscription = route.paramMap.subscribe((params) => {
      const id = params.get("id");
      if (id) {
        workspaces.open(id);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      // Leaving for another page hides the workspaces without closing them, so
      // coming back finds every tab as it was.
      workspaces.deactivate();
    });
  }
}
