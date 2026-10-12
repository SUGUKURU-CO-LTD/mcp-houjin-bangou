/**
 * 全ツール共通のレスポンス形式およびエラーコード定義
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §3.1, §4, §6.1, §6.2 (v1.4 凍結仕様)
 * - 成功時: 各ツールの出力スキーマに一致する structuredContent と、要約のテキスト1つを返す
 * - 失敗時: isError: true とし、structuredContent に error.code と error.message を格納
 * - 内部メタデータ (requestId, traceId, internal_timestamp) は一切含めない
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type CommonErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'DATA_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ToolErrorResponse extends CallToolResult {
  isError: true;
  content: [{ type: 'text'; text: string }];
  structuredContent: {
    error: {
      code: CommonErrorCode;
      message: string;
    };
  };
}

export interface ToolSuccessResponse<T extends Record<string, unknown>> extends CallToolResult {
  content: [{ type: 'text'; text: string }];
  structuredContent: T;
}

export function createSuccessResponse<T extends Record<string, unknown>>(
  summary: string,
  structuredContent: T,
): ToolSuccessResponse<T> {
  return {
    content: [
      {
        type: 'text',
        text: summary,
      },
    ],
    structuredContent,
  };
}

export function createErrorResponse(
  code: CommonErrorCode,
  message: string,
): ToolErrorResponse {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    structuredContent: {
      error: {
        code,
        message,
      },
    },
  };
}

/**
 * 国税庁 法人番号システムWeb-API機能利用規約 第6条 に基づく出典表示文言 (ローカル版)
 * 根拠: docs/plan/corp-check-interface-v1.md §6.1, [出典-A1]
 */
export const NTA_CORPORATE_WEB_API_ATTRIBUTION =
  'このサービスは、国税庁法人番号システムWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。';
