/** Container ports for per-project public listeners (D-15). */
export const PUBLIC_PORT_MIN = 10_001;
export const PUBLIC_PORT_MAX = 10_999;

/** Lowest free port in the range, or null when all are taken. */
export function lowestFreePort(used: Iterable<number>): number | null {
  const taken = new Set(used);
  for (let port = PUBLIC_PORT_MIN; port <= PUBLIC_PORT_MAX; port++) {
    if (!taken.has(port)) return port;
  }
  return null;
}
