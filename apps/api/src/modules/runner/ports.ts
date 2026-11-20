/**
 * Each project has two private "slots" so a new version can start next to
 * the old one (blue/green). Derived from the project's public port:
 *   public 10001 → slot 0: 20001, slot 1: 21001
 */
export function privatePort(publicPort: number, slot: 0 | 1): number {
  return 20_000 + (publicPort - 10_000) + slot * 1_000;
}
