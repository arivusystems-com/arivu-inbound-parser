import { createWriteStream } from 'node:fs';
import pino, { type Logger, type LoggerOptions, type StreamEntry } from 'pino';
import { resolveLogFilePath } from './log-file.js';

export interface LogContext {
  service?: string;
  tenantId?: string;
  mailboxId?: string;
  messageId?: string;
  correlationId?: string;
  queue?: string;
  jobId?: string;
}

export function createLogger(
  name: string,
  options?: { level?: string; pretty?: boolean },
): Logger {
  const isDev = process.env.NODE_ENV !== 'production';
  const level = options?.level ?? process.env.LOG_LEVEL ?? 'info';
  const logFile = resolveLogFilePath();

  const base: LoggerOptions = {
    name,
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  const streams: StreamEntry[] = [];

  if (logFile) {
    streams.push({
      level: 'trace' as const,
      stream: createWriteStream(logFile, { flags: 'a' }),
    });
  }

  if (options?.pretty ?? isDev) {
    streams.push({
      level: 'trace' as const,
      stream: pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      }),
    });
  }

  if (streams.length === 0) {
    return pino(base);
  }

  if (streams.length === 1 && !logFile) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    });
  }

  return pino(base, pino.multistream(streams));
}

export function childWithContext(logger: Logger, ctx: LogContext): Logger {
  return logger.child(ctx);
}

export { resolveLogFilePath } from './log-file.js';
export { queryLogs, type LogLine, type LogQuery } from './query-logs.js';
export type { Logger };
