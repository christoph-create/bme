import { Routes } from "@angular/router";

import { BrokerRouteShell } from "./pages/broker-workspace/broker-route-shell";
import { ConnectionForm } from "./pages/connection-form/connection-form";
import { Connections } from "./pages/connections/connections";
import { TemplatesManagement } from "./pages/templates-management/templates-management";

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "connections" },
  { path: "connections", component: Connections },
  { path: "connections/new", component: ConnectionForm },
  { path: "connections/:id/edit", component: ConnectionForm },
  // Renders nothing: the workspaces live outside the outlet so tab switching
  // cannot destroy them. See BrokerRouteShell.
  { path: "broker/:id", component: BrokerRouteShell },
  { path: "templates", component: TemplatesManagement },
];
