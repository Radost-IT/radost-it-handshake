type Level = 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

const sensitiveKey = /token|secret|password|authorization|email|signature|sig$/i;

function redact(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? '[redacted]' : value,
    ]),
  );
}

function write(level: Level, message: string, context: LogContext): void {
  console.log(JSON.stringify({ level, message, ...redact(context) }));
}

/** Structured JSON logs. Context keys that look like secrets are redacted. */
export const log = {
  info: (message: string, context: LogContext = {}) => {
    write('info', message, context);
  },
  warn: (message: string, context: LogContext = {}) => {
    write('warn', message, context);
  },
  error: (message: string, context: LogContext = {}) => {
    write('error', message, context);
  },
};

export type Logger = typeof log;
