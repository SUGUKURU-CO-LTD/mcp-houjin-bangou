import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompanyMasterRecordPrompt } from './company-master-record.js';
import { registerSalesListEnrichmentPrompt } from './sales-list-enrichment.js';
import { registerCustomerMasterDedupPrompt } from './customer-master-dedup.js';

export function registerAllPrompts(server: McpServer): void {
  registerCompanyMasterRecordPrompt(server);
  registerSalesListEnrichmentPrompt(server);
  registerCustomerMasterDedupPrompt(server);
}
