/**
 * Resource Template: `corp://{corporate_number}`
 * 法人情報を URI テンプレート経由で参照可能なリソースとして公開
 *
 * 根拠 / Source: MCP 公式仕様 (Resource Templates)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { normalizeAndValidateCorporateNumber } from '../domain/check-digit.js';
import { buildAttribution } from '../domain/corporate-number.js';
import { Result } from '../lib/result.js';

const URI_TEMPLATE = 'corp://{corporate_number}';

export function registerCorporateResourceTemplate(
  server: McpServer,
  deps: { ntaClient: NtaClient; logger: McpLogger },
): void {
  server.registerResource(
    'corporate',
    new ResourceTemplate(URI_TEMPLATE, {
      list: undefined,
    }),
    {
      title: 'Japanese corporation by corporate number',
      description:
        'URI テンプレート: corp://{corporate_number} で 13桁の法人番号を指定し、法人情報を取得。',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const startTime = performance.now();
      const rawNumber = Array.isArray(variables['corporate_number'])
        ? variables['corporate_number'][0]
        : variables['corporate_number'];
      if (typeof rawNumber !== 'string') {
        throw new Error('Invalid URI: corporate_number variable is missing');
      }

      const validation = normalizeAndValidateCorporateNumber(rawNumber);
      if (!validation.isValid) {
        deps.logger.warn('resource_access', {
          resource: 'corp://{corporate_number}',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'invalid_corporate_number',
        });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: {
                    reason: validation.reason,
                    message: `Invalid corporate number: ${rawNumber}`,
                  },
                  attribution: buildAttribution(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await deps.ntaClient.lookupByNumber({
        numbers: [validation.normalized],
        history: '0',
      });

      if (Result.isErr(result)) {
        const err = result.error;
        deps.logger.error('resource_access', {
          resource: 'corp://{corporate_number}',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: err.code,
        });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: {
                    code: err.code,
                    message: err.message,
                    httpStatus: err.httpStatus,
                  },
                  attribution: buildAttribution(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const parsed = result.value;
      const corporation = parsed.corporations[0] ?? null;

      deps.logger.info('resource_access', {
        resource: 'corp://{corporate_number}',
        count: corporation !== null ? 1 : 0,
        duration_ms: Math.round(performance.now() - startTime),
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                corporation,
                last_update_date: parsed.header.lastUpdateDate,
                attribution: buildAttribution(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
