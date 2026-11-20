/**
 * McpLogger - 標準エラー出力（process.stderr）専用の構造化ロガー
 *
 * 根拠 / Source:
 *   実装指示書v1 §3, §5(B1):
 *     - MCPプロトコルのログ（notifications/message）の送出をやめる
 *     - Logging capability宣言を外す
 *     - アプリのログはすべて標準エラー出力（stderr）へ
 *     - アクセスログに入力された法人番号・登録番号・検索語を残さない（残すのはツール名、件数、所要時間、エラー種別のみ）
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export type LogLevel =
  'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 7,
  info: 6,
  notice: 5,
  warning: 4,
  error: 3,
  critical: 2,
  alert: 1,
  emergency: 0,
};

export interface McpLogger {
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  log(level: LogLevel, logger: string, data?: Record<string, unknown>): void;
  debug(logger: string, data?: Record<string, unknown>): void;
  info(logger: string, data?: Record<string, unknown>): void;
  warn(logger: string, data?: Record<string, unknown>): void;
  warning(logger: string, data?: Record<string, unknown>): void;
  error(logger: string, data?: Record<string, unknown>): void;
}

const TRACE_SAFE_KEYS = new Set([
  'trace_id',
  'traceid',
  'span_id',
  'spanid',
  'traceparent',
  'tracestate',
]);

function isExcludedQueryInputKey(lowerKey: string): boolean {
  return (
    lowerKey.includes('corporate_number') ||
    lowerKey.includes('invoice_number') ||
    lowerKey.includes('registration_number') ||
    lowerKey === 'name' ||
    lowerKey === 'raw_name' ||
    lowerKey === 'company_name' ||
    lowerKey === 'target_company_name' ||
    lowerKey === 'company_list_text' ||
    lowerKey === 'location_hint' ||
    lowerKey === 'current_address' ||
    lowerKey === 'query' ||
    lowerKey === 'search_word' ||
    lowerKey.includes('keyword') ||
    lowerKey.includes('address')
  );
}

function isSecretKey(lowerKey: string): boolean {
  if (
    lowerKey.includes('id') &&
    (lowerKey.includes('application') || lowerKey.includes('api_key'))
  ) {
    return true;
  }
  return lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('password');
}

function sanitizeStringValue(value: string): string {
  let masked = value.replace(/id=[^&\s]+/g, 'id=***REDACTED***');
  masked = masked.replace(/T[0-9]{13}(?![0-9])/g, 'T***REDACTED***');
  masked = masked.replace(/(?<![0-9])[0-9]{13}(?![0-9])/g, '***REDACTED***');
  return masked;
}

function sanitizeAnyValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAnyValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeLogData(value as Record<string, unknown>);
  }
  return value;
}

/**
 * 入力された法人番号・登録番号・検索語・認証情報等の機密情報をログから除外・マスクする
 * 多層防御（Defense-in-depth）サニタイザー
 */
export function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    if (isExcludedQueryInputKey(lowerKey)) {
      continue;
    }

    if (isSecretKey(lowerKey)) {
      sanitized[key] = '***REDACTED***';
      continue;
    }

    if (TRACE_SAFE_KEYS.has(lowerKey) && typeof value === 'string') {
      sanitized[key] = value;
      continue;
    }

    sanitized[key] = sanitizeAnyValue(value);
  }

  return sanitized;
}

/**
 * 標準エラー出力（process.stderr）へ出力するロガーを作成する
 * MCP protocol の notifications/message は送出しない
 */
export function createMcpLogger(
  _server?: Server | unknown,
  initialLevel: LogLevel = 'info',
): McpLogger {
  let currentLevel = initialLevel;

  function shouldEmit(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel];
  }

  function emitToStderr(level: LogLevel, logger: string, data?: Record<string, unknown>): void {
    if (!shouldEmit(level)) return;

    const payload: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      logger,
    };

    if (data !== undefined) {
      const sanitized = sanitizeLogData(data);
      Object.assign(payload, sanitized);
    }

    try {
      process.stderr.write(JSON.stringify(payload) + '\n');
    } catch {
      // stderr 書き込み失敗時は安全に握りつぶす
    }
  }

  return {
    setLevel(level: LogLevel): void {
      currentLevel = level;
    },
    getLevel(): LogLevel {
      return currentLevel;
    },
    log(level: LogLevel, logger: string, data?: Record<string, unknown>): void {
      emitToStderr(level, logger, data);
    },
    debug(logger, data): void {
      emitToStderr('debug', logger, data);
    },
    info(logger, data): void {
      emitToStderr('info', logger, data);
    },
    warn(logger, data): void {
      emitToStderr('warning', logger, data);
    },
    warning(logger, data): void {
      emitToStderr('warning', logger, data);
    },
    error(logger, data): void {
      emitToStderr('error', logger, data);
    },
  };
}
