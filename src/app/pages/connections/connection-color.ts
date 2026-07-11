const PALETTE = [
  "rgb(249 115 22)",
  "rgb(59 130 246)",
  "rgb(239 68 68)",
  "rgb(34 197 94)",
  "rgb(168 85 247)",
];

/** Deterministic per-connection color, since `BrokerConnection` has no stored color field. */
export function colorForConnectionId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
