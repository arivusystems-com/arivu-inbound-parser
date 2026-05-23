/**
 * Production tenant/mailbox seed — idempotent upsert into MongoDB.
 *
 * Usage:
 *   pnpm prod:seed -- --tenant-id t_acme --mailbox-id m_support
 *   SEED_TENANT_ID=t_acme SEED_MAILBOX_ID=m_support pnpm prod:seed
 */
import { loadConfig } from '../packages/config/src/index.ts';
import { connectDatabase, seedTenantMailbox } from '../packages/database/src/index.ts';
import { buildRoutingAddress } from '../packages/routing/src/index.ts';

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function usage(): string {
  return `Usage: pnpm prod:seed -- [options]

  Required (flags or env):
    --tenant-id     SEED_TENANT_ID      e.g. t_acme
    --mailbox-id    SEED_MAILBOX_ID     e.g. m_support

  Optional:
    --tenant-name   SEED_TENANT_NAME    default: derived from tenant id
    --mailbox-name  SEED_MAILBOX_NAME   default: Support
    --local-part    SEED_ROUTING_LOCAL  default: support
    --type          SEED_MAILBOX_TYPE    shared | private (default: shared)
    --force         allow when NODE_ENV is not production

  Routing address: {local}+{tenantId}_{mailboxId}@{SMTP_DOMAIN from .env}
`;
}

function parseArgv(): { force: boolean; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  let force = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      console.log(usage());
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const value = args[++i];
      if (!value || value.startsWith('--')) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      flags[key] = value;
    }
  }
  return { force, flags };
}

function envOrFlag(
  envKey: string,
  flagKey: string,
  flags: Record<string, string>,
): string | undefined {
  const fromFlag = flags[flagKey];
  if (fromFlag) return fromFlag;
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return undefined;
}

function requireId(label: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${label}. Set SEED_* in .env or pass --${label.replace(/_/g, '-')}.`);
    console.error();
    console.error(usage());
    process.exit(1);
  }
  if (!ID_PATTERN.test(value)) {
    console.error(`${label} must match ${ID_PATTERN}: got "${value}"`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const { force, flags } = parseArgv();
  const config = loadConfig();

  if (config.NODE_ENV !== 'production' && !force) {
    console.error(
      'Refusing to run: NODE_ENV is not production.\n' +
        '  Set NODE_ENV=production in .env, or pass --force for local testing.',
    );
    process.exit(1);
  }

  const tenantId = requireId('tenant_id', envOrFlag('SEED_TENANT_ID', 'tenant_id', flags));
  const mailboxId = requireId('mailbox_id', envOrFlag('SEED_MAILBOX_ID', 'mailbox_id', flags));

  const tenantName =
    envOrFlag('SEED_TENANT_NAME', 'tenant_name', flags) ??
    tenantId.replace(/^t_/, '').replace(/_/g, ' ') ||
    tenantId;
  const mailboxName = envOrFlag('SEED_MAILBOX_NAME', 'mailbox_name', flags) ?? 'Support';
  const localPart = envOrFlag('SEED_ROUTING_LOCAL', 'local_part', flags) ?? 'support';
  const mailboxTypeRaw = envOrFlag('SEED_MAILBOX_TYPE', 'type', flags) ?? 'shared';
  if (mailboxTypeRaw !== 'shared' && mailboxTypeRaw !== 'private') {
    console.error('mailbox type must be shared or private');
    process.exit(1);
  }

  const routingAddress = buildRoutingAddress(
    localPart,
    tenantId,
    mailboxId,
    config.SMTP_DOMAIN,
  );

  const db = await connectDatabase(config.MONGODB_URI);
  await seedTenantMailbox(db, {
    tenantId,
    tenantName,
    mailboxId,
    mailboxName,
    routingAddress,
    mailboxType: mailboxTypeRaw,
  });
  await db.close();

  const smtpPort = config.SMTP_PORT;
  console.log('');
  console.log('Seeded production tenant and mailbox (idempotent upsert):');
  console.log(`  tenantId:        ${tenantId}`);
  console.log(`  tenantName:      ${tenantName}`);
  console.log(`  mailboxId:       ${mailboxId}`);
  console.log(`  mailboxName:     ${mailboxName}`);
  console.log(`  routingAddress:  ${routingAddress}`);
  console.log('');
  console.log('Smoke test (from this host):');
  console.log(
    `  swaks --to ${routingAddress} --from sender@example.com --server localhost:${smtpPort} --body "Production seed test"`,
  );
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
