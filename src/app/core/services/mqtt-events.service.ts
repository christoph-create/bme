import { Injectable } from "@angular/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Observable, share } from "rxjs";

import { MqttEvent } from "../models/mqtt-event.model";

const MQTT_EVENT_NAME = "mqtt-event";

@Injectable({ providedIn: "root" })
export class MqttEventsService {
  private readonly source$ = new Observable<MqttEvent>((subscriber) => {
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

  /**
   * One Tauri listener for the whole app, however many subscribers there are.
   *
   * Every event of every connection comes down this one channel, and each
   * subscriber filters by `connection_id`; without sharing, each of them would
   * also open its own `listen()` and receive its own copy of the whole
   * firehose. The listener is dropped again once the last subscriber leaves,
   * and re-opened on the next one.
   */
  readonly events$ = this.source$.pipe(share());
}
