/**
 * T3: validate_corporate_number
 * 法人番号のチェックデジットをローカル検証 (外部通信なし)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.4, §3.1, §4, §6.2 (v1.4 凍結仕様)
 *   国税庁仕様書 第二編 §2.1.3 (13桁・半角数字・チェックデジット付き、モジュラス9 ウェイト1-2方式)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeAndValidateCorporateNumber } from '../domain/check-digit.js';
import { getToolAnnotations } from '../domain/tool-annotations.js';
import { createSuccessResponse, createErrorResponse } from '../lib/tool-response.js';

const InputSchema = z
  .object({
    corporate_number: z
      .string()
      .regex(/^[0-9]{13}$/, '13桁の半角数字を指定してください')
      .describe('13-digit corporate number string to validate'),
  })
  .strict();

const OutputSchema = z
  .object({
    is_valid_format: z.boolean(),
    is_valid_check_digit: z.boolean(),
    error_reason: z.string().nullable(),
  })
  .strict();

export type ValidateCorporateNumberInput = z.infer<typeof InputSchema>;
export type ValidateCorporateNumberOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION_JA =
  '13桁の法人番号の形式およびモジュラス9（ウェイト1-2方式）によるチェックデジットをローカルで検証します（外部通信なし）。チェックデジットが正しくても、その法人が実在することは確認しません。';

export function registerValidateCheckDigitTool(server: McpServer): void {
  const annotations = getToolAnnotations('validate_corporate_number', 'web-api');

  server.registerTool(
    'validate_corporate_number',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
      annotations: {
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: annotations.openWorldHint,
      },
    },
    async (args) => {
      const parsedArgs = InputSchema.safeParse(args);
      if (!parsedArgs.success) {
        return createErrorResponse(
          'INVALID_INPUT',
          `法人番号の入力形式が不正です: ${parsedArgs.error.issues.map((e) => e.message).join(', ')}`,
        );
      }

      const { corporate_number } = parsedArgs.data;
      const result = normalizeAndValidateCorporateNumber(corporate_number);

      const isValidFormat = /^[0-9]{13}$/.test(corporate_number);
      const isValidCheckDigit = result.isValid;
      const errorReason = result.isValid ? null : result.reason;

      const structuredContent: ValidateCorporateNumberOutput = {
        is_valid_format: isValidFormat,
        is_valid_check_digit: isValidCheckDigit,
        error_reason: errorReason,
      };

      const summary = isValidCheckDigit
        ? `法人番号 ${corporate_number} の検証結果: 形式・チェックデジットともに正常です（※実在を保証するものではありません）。`
        : `法人番号 ${corporate_number} の検証結果: 無効です（理由: ${errorReason ?? '不明'}）。`;

      return createSuccessResponse(summary, structuredContent);
    },
  );
}
