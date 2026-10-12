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

import type { DbCorporateDataProvider } from './repository/corporate-repository.js';
import type { DataSourceMode } from './domain/tool-annotations.js';

export interface ServerDeps {
  ntaClient?: NtaClient;
  dbProvider?: DbCorporateDataProvider;
  dataSource?: DataSourceMode;
}

export function createServer(deps: ServerDeps): McpServer {
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
        '本サーバーは、国税庁が公表する日本の法人番号および適格請求書発行事業者の公表情報を照会・検証する機能を提供します。',
        '法人番号による基本情報の照会、商号による検索、チェックデジットの計算検証、およびインボイス登録番号の登録状態の確認が可能です。',
        '本サーバーが提供する情報は公表データの客観的事実の確認に限られ、税理士法第2条に定める税務相談・仕入税額控除の可否等の税務上の判断は行いません。',
        '個人の連絡先情報やプライバシーに関わるデータの入力は避けてください。',
        '公表データの内容を回答に示すときは、データの時点（data_as_of）と出典表示を併せて示してください。',
        '登録番号（T＋13桁）の確認には lookup_invoice_issuer を使ってください。',
        'lookup_invoice_issuer の not_found は、公表データに該当がないことを示すもので、登録されていないことを確定するものではありません。',
        '',
        'This server provides tools to look up and verify Japanese corporate numbers and registered invoice issuers published by the National Tax Agency of Japan.',
        'You can retrieve published basic corporate information by corporate number, search corporations by name, validate check digits, and confirm registration status of invoice issuer numbers.',
        'All returned data is limited to objective facts from public records; this service does not provide tax consultation or determine eligibility for consumption tax purchase credits under Japanese law.',
        'Please refrain from providing personal contact details or private personal information in queries.',
        'When presenting public data in a response, include the dataset date (data_as_of) and the attribution.',
        'Use lookup_invoice_issuer to check invoice registration numbers (T followed by 13 digits).',
        "A 'not_found' result from lookup_invoice_issuer means no matching record in the public dataset; it does not establish that the entity is unregistered.",
      ].join('\n'),
    },
  );

  const logger = createMcpLogger(mcpServer.server, 'info');

  registerAllTools(mcpServer, {
    ntaClient: deps.ntaClient,
    dbProvider: deps.dbProvider,
    dataSource: deps.dataSource,
    logger,
  });
  registerAllResources(mcpServer, { ntaClient: deps.ntaClient, logger });
  registerAllPrompts(mcpServer);
  registerCompletionHandler(mcpServer.server, { logger });

  return mcpServer;
}
