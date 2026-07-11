import { Injectable } from "@angular/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Observable } from "rxjs";

import { MqttEvent } from "../models/mqtt-event.model";

const MQTT_EVENT_NAME = "mqtt-event";

@Injectable({ providedIn: "root" })
export class MqttEventsService {
  readonly events$ = new Observable<MqttEvent>((subscriber) => {
    let unlisten: UnlistenFn | undefined;
    let tornDown = false;

    listen<MqttEvent>(MQTT_EVENT_NAME, (event) => {
      subscriber.next(event.payload);
    }).then(
      (fn) => {
        if (tornDown) {
          fn();
        } else {
          unlisten = fn;
        }
      },
      (err: unknown) => subscriber.error(err),
    );

    return () => {
      tornDown = true;
      unlisten?.();
    };
  });
}
