import pino, { type Logger, type LoggerOptions } from 'pino';

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
  const base: LoggerOptions = {
    name,
    level: options?.level ?? process.env.LOG_LEVEL ?? 'info',
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (options?.pretty ?? isDev) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    });
  }

  return pino(base);
}

export function childWithContext(logger: Logger, ctx: LogContext): Logger {
  return logger.child(ctx);
}

export type { Logger };
