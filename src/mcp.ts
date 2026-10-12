/**
 * McpServer factory - all capabilities declared + all primitives registered
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from './api/nta-client.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';
import { registerCompletionHandler } from './completion/handler.js';
import { createMcpLogger } from './lib/mcp-logger.js';
import { SERVER_NAME, VERSION } from './version.js';

export function createServer(deps: { ntaClient: NtaClient }): McpServer {
  const mcpServer = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
    },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: false },
        prompts: { listChanged: true },
        completions: {},
      },
      instructions: [
        "This server provides access to Japan's National Corporate Number (法人番号) public database.",
        'All operations are READ-ONLY. No write/delete/exec capabilities exist.',
        '',
        'Tools:',
        '  lookup_corporate_by_number  - Look up corporate basic info by 13-digit corporate number',
        '  search_corporate_by_name    - Search corporations by name with pagination',
        '  validate_corporate_number   - Check digit validation (local, no API call)',
        '  normalize_company_name      - Normalize company names (local)',
        '',
        'Prompts (workflow templates):',
        '  business-card-to-database   - Business card OCR → normalize → NTA lookup → CRM record',
        '  sales-list-enrichment       - Bulk enrichment of sales lists',
        '  customer-master-dedup       - Customer master dedup via corporate number',
        '',
        'Resources:',
        '  corp://{corporate_number}   - Corporation info as a resource',
        '  attribution://houjin-bangou - Static attribution resource',
        '',
        'Attribution: All outputs include mandatory attribution per Article 6 of NTA Web-API Terms',
        'and 公共データ利用規約 第1.0版. Source: 国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/).',
      ].join('\n'),
    },
  );

  const logger = createMcpLogger(mcpServer.server, 'info');

  registerAllTools(mcpServer, { ntaClient: deps.ntaClient, logger });
  registerAllResources(mcpServer, { ntaClient: deps.ntaClient, logger });
  registerAllPrompts(mcpServer);
  registerCompletionHandler(mcpServer.server, { logger });

  return mcpServer;
}
