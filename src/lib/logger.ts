/**
 * Application Logger & Cloud Logging severity mapping
 *
 * 根拠 / Source:
 *   Google Cloud Logging Severity format:
 *   https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#logseverity
 */

import pino, { type Logger, type LoggerOptions } from 'pino';

export const PINO_LEVEL_TO_SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export function levelToSeverity(label: string): string {
  return PINO_LEVEL_TO_SEVERITY[label.toLowerCase()] ?? label.toUpperCase();
}

export const cloudLoggingFormatters: NonNullable<LoggerOptions['formatters']> = {
  level(label: string) {
    return {
      level: label,
      severity: levelToSeverity(label),
    };
  },
};

export function createPinoLogger(
  options: LoggerOptions = {},
  destination: NodeJS.WritableStream = process.stderr,
): Logger {
  return pino(
    {
      ...options,
      formatters: {
        ...cloudLoggingFormatters,
        ...options.formatters,
      },
    },
    destination,
  );
}
