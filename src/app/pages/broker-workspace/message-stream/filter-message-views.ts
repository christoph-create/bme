import { MessageView } from "./message-stream";

/**
 * Keeps only the views whose displayed body contains `query`, a
 * case-insensitive substring - the same text shown in the card, so a match
 * here is always something the user could have seen and typed.
 */
export function filterMessageViews(
  views: readonly MessageView[],
  query: string,
): readonly MessageView[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return views;
  }
  return views.filter((view) => view.body.toLowerCase().includes(needle));
}
