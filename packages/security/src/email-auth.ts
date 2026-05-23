import { authenticate } from 'mailauth';
import type { EmailAuthResults, SecurityAuthMode } from '@arivu/types';

export type AuthResultStatus =
  | 'pass'
  | 'fail'
  | 'neutral'
  | 'none'
  | 'softfail'
  | 'temperror'
  | 'permerror'
  | 'skipped';

function resultOf(value: unknown): AuthResultStatus {
  if (!value || typeof value !== 'object') return 'none';
  const status = value as { result?: string };
  const r = status.result?.toLowerCase();
  if (r === 'pass' || r === 'fail' || r === 'neutral' || r === 'none' || r === 'softfail') {
    return r;
  }
  if (r === 'temperror' || r === 'permerror') return r;
  return 'none';
}

export interface VerifyEmailAuthInput {
  rawMime: Buffer;
  clientIp?: string;
  helo?: string;
  mailFrom?: string;
  mode: SecurityAuthMode;
}

export async function verifyEmailAuth(input: VerifyEmailAuthInput): Promise<EmailAuthResults> {
  const checkedAt = new Date().toISOString();

  if (input.mode === 'off') {
    return {
      checkedAt,
      mode: 'off',
      spf: { result: 'skipped' },
      dkim: { result: 'skipped' },
      dmarc: { result: 'skipped' },
      overall: 'skipped',
      summary: 'Authentication checks disabled',
    };
  }

  try {
    const report = await authenticate(input.rawMime, {
      ip: input.clientIp,
      helo: input.helo,
      sender: input.mailFrom,
      trustReceived: !input.clientIp,
      disableArc: true,
      disableBimi: true,
    });

    const spfBlock = report.spf && typeof report.spf === 'object' ? report.spf : null;
    const spfResult = resultOf(spfBlock?.status);
    const dkimResults =
      report.dkim?.results?.map((r) => resultOf(r.status)).filter((r) => r !== 'none') ?? [];
    const dkimOverall: AuthResultStatus = dkimResults.includes('pass')
      ? 'pass'
      : dkimResults.includes('fail')
        ? 'fail'
        : 'none';

    const dmarcBlock = report.dmarc && typeof report.dmarc === 'object' ? report.dmarc : null;
    const dmarcResult = resultOf(dmarcBlock?.status);
    const policy =
      dmarcBlock && 'policy' in dmarcBlock && typeof dmarcBlock.policy === 'string'
        ? dmarcBlock.policy
        : (dmarcBlock?.status as { policy?: string } | undefined)?.policy;

    const domains = report.dkim?.results
      ?.map((r) => (r as { signingDomain?: string }).signingDomain)
      .filter((d): d is string => Boolean(d));

    let overall: AuthResultStatus = 'neutral';
    if (dmarcResult === 'pass') overall = 'pass';
    else if (dmarcResult === 'fail') overall = 'fail';
    else if (spfResult === 'pass' || dkimOverall === 'pass') overall = 'pass';
    else if (spfResult === 'fail' && !dkimResults.includes('pass')) overall = 'fail';

    const summary = `SPF=${spfResult} DKIM=${dkimOverall} DMARC=${dmarcResult}`;

    return {
      checkedAt,
      mode: input.mode,
      spf: {
        result: spfResult,
        domain: spfBlock && 'domain' in spfBlock ? String(spfBlock.domain) : undefined,
      },
      dkim: { result: dkimOverall, domains },
      dmarc: {
        result: dmarcResult,
        policy,
        aligned: (dmarcBlock?.status as { aligned?: boolean } | undefined)?.aligned,
      },
      overall,
      summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'auth check failed';
    return {
      checkedAt,
      mode: input.mode,
      spf: { result: 'temperror' },
      dkim: { result: 'temperror' },
      dmarc: { result: 'temperror' },
      overall: 'temperror',
      summary: message,
    };
  }
}

export function shouldRejectAuth(results: EmailAuthResults): boolean {
  if (results.mode !== 'enforce') return false;
  if (results.overall === 'pass') return false;
  if (results.dmarc.result === 'pass') return false;
  if (results.dmarc.result === 'fail') return true;
  if (results.spf.result === 'fail' && results.dkim.result === 'fail') return true;
  if (results.spf.result === 'fail' && results.dkim.result === 'none') return true;
  return results.overall === 'fail';
}
