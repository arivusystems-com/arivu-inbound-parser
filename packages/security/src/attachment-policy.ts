/** Blocked extensions for inbound attachments (case-insensitive). */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'scr',
  'pif',
  'vbs',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'dll',
  'apk',
  'app',
  'deb',
  'dmg',
  'rpm',
  'sh',
  'bin',
  'jar',
  'hta',
  'cpl',
  'msc',
  'inf',
  'reg',
]);

const BLOCKED_MIME_PREFIXES = ['application/x-msdownload', 'application/x-msdos-program'];

export interface AttachmentScanInput {
  filename: string;
  mimeType: string;
}

export interface AttachmentScanResult {
  allowed: boolean;
  reason?: string;
}

export function scanAttachmentPolicy(input: AttachmentScanInput): AttachmentScanResult {
  const name = input.filename.toLowerCase();
  const parts = name.split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1]! : '';

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { allowed: false, reason: `Blocked extension: .${ext}` };
  }

  if (parts.length > 2) {
    const inner = parts[parts.length - 2];
    if (inner && BLOCKED_EXTENSIONS.has(inner)) {
      return { allowed: false, reason: `Blocked double extension: .${inner}.${ext}` };
    }
  }

  const mime = input.mimeType.toLowerCase();
  if (BLOCKED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    return { allowed: false, reason: `Blocked MIME type: ${input.mimeType}` };
  }

  return { allowed: true };
}
