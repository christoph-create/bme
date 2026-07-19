import { MessageFormat } from "./message-format.model";

/** Pretty-prints `payload` as JSON when `format` is "json" and it parses;
 * falls back to the raw payload otherwise (raw format, or invalid JSON). */
export function prettyPayload(payload: string, format: MessageFormat): string {
  if (format !== "json") {
    return payload;
  }
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
