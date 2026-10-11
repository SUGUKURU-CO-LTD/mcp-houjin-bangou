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
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

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

/**
 * 入力された法人番号・登録番号・検索語・認証情報等の機密情報をログから除外・マスクする
 * 多層防御（Defense-in-depth）サニタイザー
 */
function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // 法人番号・登録番号・検索語・氏名・住所等の入力値を除外
    if (
      lowerKey.includes('corporate_number') ||
      lowerKey.includes('invoice_number') ||
      lowerKey.includes('registration_number') ||
      lowerKey === 'name' ||
      lowerKey === 'query' ||
      lowerKey === 'search_word' ||
      lowerKey.includes('keyword') ||
      lowerKey.includes('address')
    ) {
      // アクセスログ要件に従い記録しない
      continue;
    }

    // 認証情報・秘密情報のマスク
    if (
      lowerKey.includes('id') &&
      (lowerKey.includes('application') || lowerKey.includes('api_key'))
    ) {
      sanitized[key] = '***REDACTED***';
    } else if (
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password')
    ) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'string') {
      // 13桁の法人番号またはT+13桁の登録番号が文字列値に含まれる場合はマスク
      let masked = value.replace(/id=[^&\s]+/g, 'id=***REDACTED***');
      masked = masked.replace(/T[0-9]{13}/g, 'T***REDACTED***');
      sanitized[key] = masked;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * 標準エラー出力（process.stderr）へ出力するロガーを作成する
 * MCP protocol の notifications/message は送出しない
 */
export function createMcpLogger(_server?: Server | unknown, initialLevel: LogLevel = 'info'): McpLogger {
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
