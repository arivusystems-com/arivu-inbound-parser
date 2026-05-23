export function parseIpList(value: string | undefined): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function normalizeClientIp(remoteAddress: string | undefined): string {
  if (!remoteAddress) return 'unknown';
  if (remoteAddress.startsWith('::ffff:')) {
    return remoteAddress.slice('::ffff:'.length);
  }
  return remoteAddress;
}

export function checkIpPolicy(
  ip: string,
  allowlist: Set<string>,
  blocklist: Set<string>,
): { allowed: boolean; reason?: string } {
  if (allowlist.size > 0) {
    return allowlist.has(ip) ? { allowed: true } : { allowed: false, reason: 'IP not on allowlist' };
  }
  if (blocklist.has(ip)) {
    return { allowed: false, reason: 'IP blocklisted' };
  }
  return { allowed: true };
}
