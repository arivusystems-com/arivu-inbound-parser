import { readFile } from 'node:fs/promises';
import { resolveLogFilePath } from './log-file.js';

export interface LogLine {
  time?: string;
  level?: string;
  name?: string;
  msg?: string;
  messageId?: string;
  tenantId?: string;
  mailboxId?: string;
  correlationId?: string;
  jobId?: string;
  queue?: string;
  err?: unknown;
  [key: string]: unknown;
}

export interface LogQuery {
  limit?: number;
  level?: string;
  messageId?: string;
  tenantId?: string;
  service?: string;
}

export async function queryLogs(query: LogQuery = {}): Promise<{
  logs: LogLine[];
  logFile: string | null;
  note?: string;
}> {
  const logFile = resolveLogFilePath();
  if (!logFile) {
    return {
      logs: [],
      logFile: null,
      note: 'File logging disabled (LOG_FILE=false). Enable default logs/arivu.log or set LOG_FILE path.',
    };
  }

  let raw: string;
  try {
    raw = await readFile(logFile, 'utf8');
  } catch {
    return {
      logs: [],
      logFile,
      note: 'Log file not created yet — start dev:core and send a test email.',
    };
  }

  const limit = Math.min(query.limit ?? 200, 500);
  const lines = raw.trim().split('\n').filter(Boolean);
  const tail = lines.slice(-2000);

  const parsed: LogLine[] = [];
  for (const line of tail) {
    try {
      parsed.push(JSON.parse(line) as LogLine);
    } catch {
      parsed.push({ msg: line, level: 'info' });
    }
  }

  let filtered = parsed;
  if (query.level) {
    const lvl = query.level.toLowerCase();
    filtered = filtered.filter((l) => (l.level ?? '').toLowerCase() === lvl);
  }
  if (query.messageId) {
    filtered = filtered.filter(
      (l) =>
        l.messageId === query.messageId ||
        l.correlationId === query.messageId ||
        JSON.stringify(l).includes(query.messageId!),
    );
  }
  if (query.tenantId) {
    filtered = filtered.filter((l) => l.tenantId === query.tenantId);
  }
  if (query.service) {
    filtered = filtered.filter((l) => (l.name ?? '').includes(query.service!));
  }

  return {
    logs: filtered.slice(-limit),
    logFile,
  };
}
