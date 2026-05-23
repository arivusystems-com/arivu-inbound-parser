import { loadConfig } from '../packages/config/src/index.ts';
import { createObjectStorage } from '../packages/storage/src/index.ts';
import { Readable } from 'node:stream';

async function main() {
  const config = loadConfig();

  console.log('Storage config (sanitized):');
  console.log('  endpoint:', config.STORAGE_ENDPOINT);
  console.log('  region:  ', config.STORAGE_REGION);
  console.log('  bucket:  ', config.STORAGE_BUCKET);
  const accessKey = config.STORAGE_ACCESS_KEY.trim();
  const secretKey = config.STORAGE_SECRET_KEY.trim();
  const looksLikeOciSecret = (value: string) =>
    value.length >= 40 && /^[A-Za-z0-9+/]+=*$/.test(value);

  console.log('  accessKey length:', accessKey.length);
  console.log('  secretKey length:', secretKey.length);
  console.log('  pathStyle:', config.STORAGE_FORCE_PATH_STYLE ?? true);

  if (accessKey.includes('@')) {
    throw new Error(
      'STORAGE_ACCESS_KEY looks like an email. Use the Access Key from OCI Customer secret keys (not your login).',
    );
  }
  if (secretKey.length < 40 || !looksLikeOciSecret(secretKey)) {
    throw new Error(
      'STORAGE_SECRET_KEY is missing or invalid. OCI secrets are ~44-character base64 strings ' +
        '(letters, numbers, +, /, often ending with =). Quote the full value in .env if it contains # or spaces.',
    );
  }
  if (looksLikeOciSecret(accessKey) && !looksLikeOciSecret(secretKey)) {
    throw new Error(
      'Keys may be swapped: STORAGE_ACCESS_KEY looks like an OCI secret (base64). ' +
        'Access Key and Secret Key must come from the same Customer secret key pair in OCI Console.',
    );
  }

  const storage = createObjectStorage(config);
  const key = await storage.putRawMime('t_test', `probe_${Date.now()}`, Readable.from('ok'), {
    maxBytes: 1024,
  });
  console.log('OCI upload OK:', key);
  const stream = await storage.getRawMime(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  console.log('OCI read OK:', Buffer.concat(chunks).toString());
}

main().catch((err) => {
  console.error('OCI storage check failed:', err instanceof Error ? err.message : err);
  console.error('');
  console.error('Checklist:');
  console.error('  1. Customer secret keys: Access Key + Secret from the SAME generate action');
  console.error('  2. Quote both keys in .env if they contain #, +, or =');
  console.error('  3. STORAGE_REGION matches endpoint (e.g. ap-hyderabad-1)');
  console.error('  4. Bucket exists in that region');
  console.error('  See docs/OCI-STORAGE.md');
  process.exit(1);
});
