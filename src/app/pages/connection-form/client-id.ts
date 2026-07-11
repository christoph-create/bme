const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Prefills the Client ID field, matching the prototype's `<prefix>-<random>` pattern. */
export function randomClientId(): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `bme-${suffix}`;
}
