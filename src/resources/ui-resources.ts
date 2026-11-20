/**
 * UI Resources for MCP Apps (`io.modelcontextprotocol/ui`).
 *
 * Registers `ui://corporate-card/mcp-app.html` (shared by `lookup_corporate_by_number`
 * and `lookup_invoice_issuer`) and `ui://search-results/mcp-app.html`
 * (`search_corporate_by_name`) backed by a single deduplicated single-file bundle
 * (`dist/ui/mcp-app.html`) with zero-network CSP and clipboard-write permission.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { McpUiResourceMeta } from '@modelcontextprotocol/ext-apps';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SHARED_UI_META: McpUiResourceMeta = {
  csp: {
    resourceDomains: [],
    connectDomains: [],
    frameDomains: [],
    baseUriDomains: [],
  },
  permissions: {
    clipboardWrite: {},
  },
  prefersBorder: false,
};

const SHARED_DIST_HTML_PATH = fileURLToPath(new URL('../../dist/ui/mcp-app.html', import.meta.url));

const UI_RESOURCES = [
  {
    name: 'Corporate Card UI',
    uri: 'ui://corporate-card/mcp-app.html',
    defaultMode: 'corporate-card' as const,
    legacyDistPath: fileURLToPath(
      new URL('../../dist/ui/corporate-card/mcp-app.html', import.meta.url),
    ),
    description:
      '法人番号照会および適格請求書発行事業者照会の結果を単一カードとして表示する UI Resource',
  },
  {
    name: 'Search Results UI',
    uri: 'ui://search-results/mcp-app.html',
    defaultMode: 'search-results' as const,
    legacyDistPath: fileURLToPath(
      new URL('../../dist/ui/search-results/mcp-app.html', import.meta.url),
    ),
    description: '法人名検索結果を一覧表として表示する UI Resource',
  },
] as const;

const htmlCache = new Map<string, string>();

export function clearUiResourceCache(): void {
  htmlCache.clear();
}

/**
 * Customize only HTML attributes / `<title>` / initial `<main>` placeholder outside
 * `<script>` and `<style>` so inline SHA-256 CSP hashes remain strictly intact.
 */
function specializeSharedBundleHtml(
  sharedHtml: string,
  defaultMode: 'corporate-card' | 'search-results',
): string {
  if (defaultMode === 'corporate-card') {
    return sharedHtml;
  }
  return sharedHtml
    .replace(
      /<html\s+lang="ja"\s+data-default-mode="corporate-card">/i,
      '<html lang="ja" data-default-mode="search-results">',
    )
    .replace(/<title>Corporate Card<\/title>/i, '<title>Search Results</title>')
    .replace(
      /<main id="app" class="card">\s*<p class="empty">[^<]*<\/p>\s*<\/main>/i,
      '<main id="app"><p class="empty">検索結果の照会を待っています。</p></main>',
    );
}

export function registerUiResources(server: McpServer): void {
  for (const resource of UI_RESOURCES) {
    registerAppResource(
      server,
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: RESOURCE_MIME_TYPE,
        _meta: {
          ui: SHARED_UI_META,
        },
      },
      async () => {
        let html = htmlCache.get(resource.uri);
        if (html === undefined) {
          try {
            const rawShared = await readFile(SHARED_DIST_HTML_PATH, 'utf8');
            const specialized = specializeSharedBundleHtml(rawShared, resource.defaultMode);
            htmlCache.set(resource.uri, specialized);
            html = specialized;
          } catch {
            try {
              const legacyLoaded = await readFile(resource.legacyDistPath, 'utf8');
              htmlCache.set(resource.uri, legacyLoaded);
              html = legacyLoaded;
            } catch {
              html = buildFallbackHtml(resource.name);
            }
          }
        }
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
              _meta: {
                ui: SHARED_UI_META,
              },
            },
          ],
        };
      },
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFallbackHtml(title: string): string {
  const safeTitle = escapeHtml(title);
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'" />',
    '<meta name="color-scheme" content="light dark" />',
    '<meta name="text-scale" content="scale" />',
    `<title>${safeTitle}</title>`,
    '</head>',
    '<body>',
    `<p>${safeTitle} is not built yet. Run <code>pnpm build:ui</code>.</p>`,
    '</body>',
    '</html>',
  ].join('');
}
