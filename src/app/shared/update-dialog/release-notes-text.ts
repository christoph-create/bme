const NO_NOTES = "No release notes for this version.";

/**
 * Tidies GitHub release notes for display as plain text: normalises Windows
 * line endings, collapses runs of blank lines, and gives absent or empty notes
 * a readable fallback. Keeps the template free of `??` chains.
 */
export function releaseNotesText(notes: string | null): string {
  if (notes === null) return NO_NOTES;

  const normalised = notes
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalised === "" ? NO_NOTES : normalised;
}
