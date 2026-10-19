/**
 * 型付きエラー階層
 * Typed error hierarchy
 * Hierarki error bertipe
 *
 * 根拠: SEP-1303 Input Validation Errors as Tool Execution Errors
 *   → バリデーション失敗は JSON-RPC エラーではなく tool 結果 (isError: true) として返す
 */

export type NtaErrorCode =
  | 'http_400'
  | 'http_403'
  | 'http_404'
  | 'http_500'
  | 'http_other'
  | 'timeout'
  | 'parse_error'
  | 'network_error'
  | 'unknown';

/**
 * 国税庁 API 由来のエラー
 * Error originating from NTA Web-API
 */
export class NtaApiError extends Error {
  override readonly name = 'NtaApiError';
  constructor(
    message: string,
    public readonly code: NtaErrorCode,
    public readonly httpStatus?: number,
    public readonly ntaErrorCode?: string,
  ) {
    super(message);
  }

  static fromHttpStatus(status: number, body?: string): NtaApiError {
    let code: NtaErrorCode;
    switch (status) {
      case 400:
        code = 'http_400';
        break;
      case 403:
        code = 'http_403';
        break;
      case 404:
        code = 'http_404';
        break;
      case 500:
        code = 'http_500';
        break;
      default:
        code = 'http_other';
    }
    const message = body
      ? `NTA API responded HTTP ${status}: ${body.slice(0, 200)}`
      : `NTA API responded HTTP ${status}`;
    return new NtaApiError(message, code, status);
  }

  static fromUnknown(err: unknown): NtaApiError {
    if (err instanceof NtaApiError) return err;
    if (err instanceof Error) {
      if (err.name === 'AbortError' || err.message.toLowerCase().includes('abort')) {
        return new NtaApiError('NTA API request timed out', 'timeout');
      }
      return new NtaApiError(`NTA API network error: ${err.message}`, 'network_error');
    }
    return new NtaApiError('Unknown NTA API error', 'unknown');
  }
}

/**
 * 入力バリデーションエラー (SEP-1303 でツール実行エラーとして返却)
 */
export class InputValidationError extends Error {
  override readonly name = 'InputValidationError';
  constructor(
    message: string,
    public readonly field?: string,
    public readonly guidance?: string,
  ) {
    super(message);
  }
}

/**
 * レート制限関連エラー
 */
export class RateLimitError extends Error {
  override readonly name = 'RateLimitError';
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/**
 * 未実装 (部分実装への明示的マーカー、Zero Placeholder 原則)
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor(feature: string, targetVersion: string) {
    super(`${feature} is not implemented yet. Planned for ${targetVersion}.`);
  }
}

/**
 * Drizzle や Node.js の Error から SQL バインドパラメータ (\nparams:) を除外したエラー文言を抽出する。
 * err.cause が Error の場合は、その message も「 / cause: …」として続けて残す（cause の文言からも \nparams: 以降を除外）。
 */
export function formatErrorWithCause(err: unknown, fallbackMessage?: string): string {
  const rawMessage = err instanceof Error ? err.message : (fallbackMessage ?? String(err));
  let msg = rawMessage.split('\nparams:')[0]?.trim() ?? rawMessage;
  if (err instanceof Error && err.cause instanceof Error) {
    const rawCause = err.cause.message;
    const cleanCause = rawCause.split('\nparams:')[0]?.trim() ?? rawCause;
    msg += ` / cause: ${cleanCause}`;
  }
  return msg;
}
