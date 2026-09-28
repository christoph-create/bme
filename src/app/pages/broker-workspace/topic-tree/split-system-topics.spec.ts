import { describe, expect, it } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import { splitSystemTopics } from "./split-system-topics";

const MESSAGE: StoredMessage = {
  payload: [1],
  payloadLen: 1,
  qos: "AtMostOnce",
  retain: false,
  properties: null,
  receivedAt: 0,
};

function topics(...names: string[]) {
  return new Map(names.map((name) => [name, [MESSAGE]] as const));
}

describe("splitSystemTopics", () => {
  it("puts the broker's tree on one side and the user's on the other", () => {
    const { user, system } = splitSystemTopics(
      topics(
        "$SYS/broker/uptime",
        "home/livingroom/climate",
        "$SYS/broker/clients/connected",
      ),
    );

    expect([...user.keys()]).toEqual(["home/livingroom/climate"]);
    expect([...system.keys()]).toEqual([
      "$SYS/broker/uptime",
      "$SYS/broker/clients/connected",
    ]);
  });

  /** Only the broker's own tree counts. A topic that merely mentions `$SYS`
   * somewhere is the user's. */
  it("needs the prefix, not a mention", () => {
    const { user, system } = splitSystemTopics(
      topics("sensors/$SYS/temp", "$SYSTEM/load", "$SYS"),
    );

    expect([...user.keys()]).toEqual([
      "sensors/$SYS/temp",
      "$SYSTEM/load",
      "$SYS",
    ]);
    expect(system.size).toBe(0);
  });

  it("hands the messages through untouched", () => {
    const { user } = splitSystemTopics(topics("home/climate"));

    expect(user.get("home/climate")).toEqual([MESSAGE]);
  });

  it("copes with nothing at all", () => {
    const { user, system } = splitSystemTopics(new Map());

    expect(user.size).toBe(0);
    expect(system.size).toBe(0);
  });
});
