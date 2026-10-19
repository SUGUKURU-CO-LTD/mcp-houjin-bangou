/**
 * UI Resources for MCP Apps (v0.2.0 preparation).
 *
 * These resources are display-only shells. Tool metadata will be wired to these
 * resources in v0.2.0 after host compatibility checks.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const UI_RESOURCES = [
  {
    name: 'Corporate Card UI',
    uri: 'ui://corporate-card/mcp-app.html',
    distPath: fileURLToPath(new URL('../../dist/ui/corporate-card/mcp-app.html', import.meta.url)),
    description: '法人番号検索結果を単一カードとして表示する UI Resource',
  },
  {
    name: 'Search Results UI',
    uri: 'ui://search-results/mcp-app.html',
    distPath: fileURLToPath(new URL('../../dist/ui/search-results/mcp-app.html', import.meta.url)),
    description: '法人名検索結果を一覧表として表示する UI Resource',
  },
] as const;

export function registerUiResources(server: McpServer): void {
  for (const resource of UI_RESOURCES) {
    registerAppResource(server, resource.name, resource.uri, {}, async () => {
      let html: string;
      try {
        html = await readFile(resource.distPath, 'utf8');
      } catch {
        html = buildFallbackHtml(resource.name);
      }
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  resourceDomains: [],
                  connectDomains: [],
                },
              },
            },
          },
        ],
      };
    });
  }
}

function buildFallbackHtml(title: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>${title}</title></head><body><p>${title} is not built yet. Run <code>pnpm build:ui</code>.</p></body></html>`;
}
