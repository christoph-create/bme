import { Routes } from "@angular/router";

import { BrokerWorkspace } from "./pages/broker-workspace/broker-workspace";
import { ConnectionForm } from "./pages/connection-form/connection-form";
import { Connections } from "./pages/connections/connections";

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "connections" },
  { path: "connections", component: Connections },
  { path: "connections/new", component: ConnectionForm },
  { path: "broker", component: BrokerWorkspace },
];
