import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import { UpdateCheck } from "../models/update-check.model";

@Injectable({ providedIn: "root" })
export class UpdateService {
  getAppVersion(): Promise<string> {
    return invoke("get_app_version");
  }

  /** `force` skips the backend's once-a-day throttle - pass it when the user
   *  pressed the button, not for the automatic startup check. */
  check(force: boolean): Promise<UpdateCheck> {
    return invoke("check_for_updates", { force });
  }

  skip(version: string): Promise<void> {
    return invoke("skip_update_version", { version });
  }
}
