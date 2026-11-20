/**
 * MCP Completion handler (completion/complete)
 *
 * 登録済み Prompt の引数（会社名・所在地ヒント・複数社リスト最終行）に対して補完候補を返却する。
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
import { PREFECTURE_CODES } from '../domain/prefecture-codes.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { extractTraceFromMcpExtra } from '../lib/trace-context.js';

const MAX_COMPLETION_VALUES = 20;

const REGISTERED_PROMPTS = new Set([
  'company-master-record',
  'customer-master-dedup',
  'sales-list-enrichment',
]);

const DOMESTIC_PREFECTURES: ReadonlyArray<{ code: string; name: string }> = Object.entries(
  PREFECTURE_CODES,
)
  .filter(([code]) => code !== '99')
  .map(([code, name]) => ({ code, name }));

const EMPTY_COMPLETION: CompleteResult = {
  completion: {
    values: [],
    total: 0,
    hasMore: false,
  },
};

function toCompletionResult(allUniqueValues: string[]): CompleteResult {
  const values = allUniqueValues.slice(0, MAX_COMPLETION_VALUES);
  return {
    completion: {
      values,
      total: allUniqueValues.length,
      hasMore: allUniqueValues.length > values.length,
    },
  };
}

function completeCompanyNameCandidates(rawValue: string): CompleteResult {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return EMPTY_COMPLETION;
  }
  const normalized = normalizeCompanyName(trimmed);
  const uniqueNames = Array.from(new Set(normalized.normalized_candidates.map((c) => c.name)));
  return toCompletionResult(uniqueNames);
}

function completePrefectureHint(rawValue: string): CompleteResult {
  const trimmed = rawValue.trim().normalize('NFKC');
  if (trimmed.length === 0) {
    return toCompletionResult(DOMESTIC_PREFECTURES.map((p) => p.name));
  }
  const matched = DOMESTIC_PREFECTURES.filter(
    (p) => p.name.includes(trimmed) || p.code.startsWith(trimmed),
  ).map((p) => p.name);
  return toCompletionResult(Array.from(new Set(matched)));
}

function completeCompanyListLastLine(rawValue: string): CompleteResult {
  if (rawValue.length === 0 || rawValue.endsWith('\n')) {
    return EMPTY_COMPLETION;
  }
  const lines = rawValue.split('\n');
  if (lines.length > 20) {
    return EMPTY_COMPLETION;
  }
  const lastLine = lines[lines.length - 1] ?? '';
  const trimmedLast = lastLine.trim();
  if (trimmedLast.length === 0) {
    return EMPTY_COMPLETION;
  }
  const prefixLines = lines.slice(0, -1);
  const prefix = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n` : '';
  const normalized = normalizeCompanyName(trimmedLast);
  const uniqueFullTexts = Array.from(
    new Set(normalized.normalized_candidates.map((c) => `${prefix}${c.name}`)),
  );
  return toCompletionResult(uniqueFullTexts);
}

export function registerCompletionHandler(server: Server, deps: { logger: McpLogger }): void {
  server.setRequestHandler(
    CompleteRequestSchema,
    async (req: CompleteRequest, extra): Promise<CompleteResult> => {
      const { ref, argument } = req.params;
      const trace = extractTraceFromMcpExtra(extra);

      deps.logger.debug('completion.request', {
        refType: ref.type,
        argName: argument.name,
        valueLength: argument.value.length,
        trace_id: trace.traceContext.traceId,
      });

      if (ref.type === 'ref/prompt') {
        return completePromptArgument(ref.name ?? '', argument.name, argument.value);
      }

      return EMPTY_COMPLETION;
    },
  );
}

/**
 * Prompt 引数の補完（登録済み Prompt 名の検証・重複排除・所在地/複数行補完対応）
 */
function completePromptArgument(
  promptName: string,
  argName: string,
  value: string,
): CompleteResult {
  if (!REGISTERED_PROMPTS.has(promptName)) {
    return EMPTY_COMPLETION;
  }

  if (promptName === 'company-master-record') {
    if (argName === 'company_name') {
      return completeCompanyNameCandidates(value);
    }
    if (argName === 'location_hint') {
      return completePrefectureHint(value);
    }
    return EMPTY_COMPLETION;
  }

  if (promptName === 'customer-master-dedup') {
    if (argName === 'target_company_name') {
      return completeCompanyNameCandidates(value);
    }
    if (argName === 'current_address') {
      return completePrefectureHint(value);
    }
    return EMPTY_COMPLETION;
  }

  if (promptName === 'sales-list-enrichment' && argName === 'company_list_text') {
    return completeCompanyListLastLine(value);
  }

  return EMPTY_COMPLETION;
}
