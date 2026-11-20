/**
 * Finds a port's code.run URL in NF_HOSTS, which Northflank injects as a
 * comma-separated list like
 *   "dash--stackdock--proj--abc1.code.run,shop--stackdock--proj--abc1.code.run".
 * Only Northflank-generated (code.run) hosts are considered.
 */
export function ownUrlFor(
  portName: string,
  nfHosts: string | undefined,
): string | null {
  if (!nfHosts) return null;
  const host = nfHosts
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .find((h) => h.startsWith(`${portName}--`) && h.endsWith('.code.run'));
  return host ? `https://${host}/` : null;
}
