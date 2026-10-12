import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { registerUiResources } from './ui-resources.js';

export function registerAllResources(
  server: McpServer,
  _deps: { ntaClient: NtaClient; logger: McpLogger },
): void {
  // リソースはUIリソースのみとする (v1.5 仕様)
  registerUiResources(server);
}
