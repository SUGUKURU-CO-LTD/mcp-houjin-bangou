/**
 * 全ツールの MCP アノテーションを一元生成する関数
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §1 表 (仕様 v1.8：照会ツールはホスト版・ローカル版とも openWorldHint=true)
 */

export const DATA_SOURCE_MODES = ['web-api', 'db'] as const;
export type DataSourceMode = (typeof DATA_SOURCE_MODES)[number];

export type ToolName =
  | 'lookup_corporate_by_number'
  | 'search_corporate_by_name'
  | 'lookup_invoice_issuer'
  | 'validate_corporate_number'
  | 'normalize_company_name';

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export function getToolAnnotations(
  toolName: ToolName,
  dataSource: DataSourceMode = 'web-api',
): ToolAnnotations {
  switch (toolName) {
    case 'lookup_corporate_by_number':
      return {
        title: 'Look up Corporation by Corporate Number',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };
    case 'search_corporate_by_name':
      return {
        title: 'Search Corporations by Name',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };
    case 'lookup_invoice_issuer':
      return {
        title: 'Look up Registered Invoice Issuer by T-number',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };
    case 'validate_corporate_number':
      return {
        title: 'Validate Corporate Number Check Digit (Local)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      };
    case 'normalize_company_name':
      return {
        title: 'Normalize Company Name (Local)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      };
  }
}
