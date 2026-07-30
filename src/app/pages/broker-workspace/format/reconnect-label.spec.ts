import { describe, expect, it } from "vitest";

import { reconnectLabel } from "./reconnect-label";

describe("reconnectLabel", () => {
  it("names the attempt and the budget it is spending", () => {
    expect(reconnectLabel(3, 10)).toBe("Reconnecting… (attempt 3 of 10)");
  });

  it("reads naturally on the first and last attempt", () => {
    expect(reconnectLabel(1, 10)).toBe("Reconnecting… (attempt 1 of 10)");
    expect(reconnectLabel(10, 10)).toBe("Reconnecting… (attempt 10 of 10)");
  });

  // The backend resets the attempt counter on every successful session, so a
  // flapping broker can in principle report an attempt past the configured
  // maximum before the two sides agree again. "11 of 10" would look broken.
  it("never claims more attempts than the maximum", () => {
    expect(reconnectLabel(12, 10)).toBe("Reconnecting… (attempt 10 of 10)");
  });

  it("drops the count when there is only one attempt to make", () => {
    expect(reconnectLabel(1, 1)).toBe("Reconnecting…");
  });
});
