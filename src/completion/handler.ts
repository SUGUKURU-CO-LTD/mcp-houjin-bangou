/**
 * MCP Completion handler (completion/complete)
 *
 * Resource Template `corp://{corporate_number}` の引数補完では、
 * normalizeCompanyName (T7) を裏で駆動して会社名ベースの候補を返す実装も可能だが、
 * corporate_number は数字13桁なので、国税庁 API を叩かず「ローカルでのチェックデジット
 * 検証済み候補」を補完対象とする。
 *
 * 根拠 / Source: MCP 公式仕様 server/utilities/completion
 *   values: max 100 items
 *   total: optional
 *   hasMore: boolean
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CompleteRequestSchema,
  type CompleteRequest,
  type CompleteResult,
} from '@modelcontextprotocol/sdk/types.js';
import { normalizeCompanyName } from '../domain/normalizer.js';
import type { McpLogger } from '../lib/mcp-logger.js';

export function registerCompletionHandler(server: Server, deps: { logger: McpLogger }): void {
  server.setRequestHandler(
    CompleteRequestSchema,
    async (req: CompleteRequest): Promise<CompleteResult> => {
      const { ref, argument } = req.params;

      deps.logger.debug('completion.request', {
        refType: ref.type,
        argName: argument.name,
        valueLength: argument.value.length,
      });

      // Prompt 引数補完 (v0.2.0 で prompt 実装時に動く)
      if (ref.type === 'ref/prompt') {
        return completePromptArgument(ref.name ?? '', argument.name, argument.value);
      }

      return {
        completion: {
          values: [],
          total: 0,
          hasMore: false,
        },
      };
    },
  );
}

/**
 * Prompt 引数の補完
 *
 * 会社名引数に対して normalizeCompanyName による候補提示をサポート
 */
function completePromptArgument(
  _promptName: string,
  argName: string,
  value: string,
): CompleteResult {
  if (
    argName === 'company_name' ||
    argName === 'target_company_name' ||
    argName === 'name' ||
    argName === 'raw_input'
  ) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { completion: { values: [], total: 0, hasMore: false } };
    }
    const normalized = normalizeCompanyName(trimmed);
    const values = normalized.normalized_candidates.slice(0, 20).map((c) => c.name);
    return {
      completion: {
        values,
        total: values.length,
        hasMore: false,
      },
    };
  }

  return {
    completion: {
      values: [],
      total: 0,
      hasMore: false,
    },
  };
}
