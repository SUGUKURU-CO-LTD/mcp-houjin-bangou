/**
 * 全ツールの MCP アノテーションを一元生成する関数
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §1 表 (v1.4 凍結仕様)
 * - ホスト版 (自社DB保持データ) では openWorldHint は false (提出用)
 * - ローカル版 (Web-API直接呼出) では外部通信を行うツールのみ openWorldHint は true
 */

export type DataSourceMode = 'web-api' | 'database' | 'db';

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
        openWorldHint: dataSource === 'web-api',
      };
    case 'search_corporate_by_name':
      return {
        title: 'Search Corporations by Name',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: dataSource === 'web-api',
      };
    case 'lookup_invoice_issuer':
      return {
        title: 'Lookup Registered Invoice Issuer by T-number',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: dataSource === 'web-api',
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
