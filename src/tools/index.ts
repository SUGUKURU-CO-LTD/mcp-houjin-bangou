/**
 * Tool registration orchestrator
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §1 (v1.4 凍結仕様)
 * - 提出対象ツール: lookup_corporate_by_number, search_corporate_by_name, validate_corporate_number, normalize_company_name
 *   (lookup_invoice_issuer は B5 で追加、get_attribution は O1 により削除)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { registerLookupByNumberTool } from './lookup-by-number.js';
import { registerSearchByNameTool } from './search-by-name.js';
import { registerValidateCheckDigitTool } from './validate-check-digit.js';
import { registerNormalizeCompanyNameTool } from './normalize-company-name.js';

import type { DbCorporateDataProvider } from '../repository/corporate-repository.js';
import type { DbInvoiceDataProvider } from '../repository/invoice-repository.js';
import type { DataSourceMode } from '../domain/tool-annotations.js';
import { registerLookupInvoiceIssuerTool } from './lookup-invoice-issuer.js';

export interface ToolDeps {
  ntaClient?: NtaClient;
  dbProvider?: DbCorporateDataProvider;
  invoiceDbProvider?: DbInvoiceDataProvider;
  dataSource?: DataSourceMode;
  logger: McpLogger;
}

export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  registerLookupByNumberTool(server, deps);
  registerSearchByNameTool(server, deps);
  registerLookupInvoiceIssuerTool(server, deps);
  registerValidateCheckDigitTool(server);
  registerNormalizeCompanyNameTool(server);
}
