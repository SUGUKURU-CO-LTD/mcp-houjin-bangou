import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DataSourceMode } from '../domain/tool-annotations.js';
import { registerCompanyMasterRecordPrompt } from './company-master-record.js';
import { registerSalesListEnrichmentPrompt } from './sales-list-enrichment.js';
import { registerCustomerMasterDedupPrompt } from './customer-master-dedup.js';

export interface PromptDeps {
  dataSource?: DataSourceMode;
}

export function registerAllPrompts(server: McpServer, deps?: PromptDeps): void {
  const dataSource = deps?.dataSource ?? 'web-api';
  registerCompanyMasterRecordPrompt(server, { dataSource });
  registerSalesListEnrichmentPrompt(server, { dataSource });
  registerCustomerMasterDedupPrompt(server, { dataSource });
}
