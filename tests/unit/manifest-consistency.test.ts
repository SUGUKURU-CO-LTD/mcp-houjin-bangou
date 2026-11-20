import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERSION, SERVER_NAME } from '../../src/version.js';
import {
  MCP_SERVER_ID,
  PRODUCT_NAME_EN,
  PRODUCT_WEBSITE_URL,
  PUBLIC_BASE_URL,
  REPOSITORY_URL,
  SUPPORT_EMAIL,
} from '../../src/config/product.js';
import { buildServerCard, buildAiCatalog } from '../../src/server.js';

function readJson<T = Record<string, unknown>>(relativePath: string): T {
  const fullPath = resolve(process.cwd(), relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

describe('Manifest & Metadata Consistency', () => {
  const pkg = readJson<{
    name: string;
    mcpName: string;
    version: string;
  }>('package.json');
  const serverJson = readJson<{
    $schema: string;
    name: string;
    title: string;
    version: string;
    websiteUrl: string;
    repository: { url: string };
    remotes: Array<{ type: string; url: string }>;
    packages: Array<{
      identifier: string;
      version: string;
      environmentVariables: Array<{ name: string; description: string }>;
    }>;
  }>('server.json');
  const serverCardFile = readJson<Record<string, unknown>>('.well-known/mcp.json');
  const pluginJson = readJson<Record<string, unknown>>('plugin.json');
  const cursorPluginJson = readJson<Record<string, unknown>>('.cursor-plugin/plugin.json');
  const mcpJson = readJson<{ mcpServers: Record<string, { type?: string; url: string }> }>(
    'mcp.json',
  );
  const dotMcpJson = readJson<{ mcpServers: Record<string, { type?: string; url: string }> }>(
    '.mcp.json',
  );
  const cursorMcpJson = readJson<{ mcpServers: Record<string, { type?: string; url: string }> }>(
    '.cursor/mcp.json',
  );
  const agyMcpConfig = readJson<{
    mcpServers: Record<
      string,
      { url?: string; serverUrl?: string; tools?: Record<string, unknown> }
    >;
  }>('mcp_config.json');

  it('keeps semantic version synchronized across all manifests and src/version.ts', () => {
    expect(pkg.version).toBe(VERSION);
    expect(serverJson.version).toBe(VERSION);
    expect(serverJson.packages[0]?.version).toBe(VERSION);
    expect(serverCardFile.version).toBe(VERSION);
    expect(pluginJson.version).toBe(VERSION);
    expect(cursorPluginJson.version).toBe(VERSION);
  });

  it('validates Official MCP Registry server.json schema (2025-12-11), identifiers, and env vars', () => {
    expect(serverJson.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(serverJson.name).toBe(MCP_SERVER_ID);
    expect(pkg.mcpName).toBe(MCP_SERVER_ID);
    expect(serverJson.title).toBe(PRODUCT_NAME_EN);
    expect(serverJson.websiteUrl).toBe(PRODUCT_WEBSITE_URL);
    expect(serverJson.repository.url).toBe(REPOSITORY_URL);
    expect(serverJson.remotes[0]?.url).toBe(`${PUBLIC_BASE_URL}/mcp`);
    expect(serverJson.packages[0]?.identifier).toBe(SERVER_NAME);
    expect(pkg.name).toBe(SERVER_NAME);

    const envDescriptions = JSON.stringify(serverJson.packages[0]?.environmentVariables ?? []);
    expect(envDescriptions).not.toContain('nta_api');
    expect(envDescriptions).toContain('web-api');
  });

  it('ensures .well-known/mcp.json matches buildServerCard() and SEP-2127 fields + AI Catalog', () => {
    const builtCard = buildServerCard();
    expect(serverCardFile).toEqual(builtCard);
    expect(serverCardFile.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    );
    expect(serverCardFile.name).toBe(MCP_SERVER_ID);
    expect(serverCardFile.title).toBe(PRODUCT_NAME_EN);
    expect(serverCardFile.websiteUrl).toBe(PRODUCT_WEBSITE_URL);

    const maintainer = serverCardFile.maintainer as { email: string };
    expect(maintainer.email).toBe(SUPPORT_EMAIL);

    const catalog = buildAiCatalog() as {
      entries: Array<{ type: string; name: string; url: string }>;
    };
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.type).toBe('application/mcp-server-card+json');
    expect(catalog.entries[0]?.name).toBe(MCP_SERVER_ID);
    expect(catalog.entries[0]?.url).toBe(`${PUBLIC_BASE_URL}/.well-known/mcp.json`);
  });

  it('ensures Google Antigravity plugin.json and mcp_config.json use canonical supported keys', () => {
    const allowedTopLevelKeys = new Set([
      'name',
      'displayName',
      'version',
      'description',
      'logo',
      'suggestedPrompts',
      'author',
      'homepage',
      'repository',
      'disabled',
    ]);
    for (const key of Object.keys(pluginJson)) {
      expect(allowedTopLevelKeys.has(key)).toBe(true);
    }
    const author = pluginJson.author as Record<string, unknown>;
    expect(author.email).toBeUndefined();

    const agyEntry = agyMcpConfig.mcpServers['houjin-bangou'];
    expect(agyEntry?.url).toBe(`${PUBLIC_BASE_URL}/mcp`);
    expect(agyEntry?.serverUrl).toBeUndefined();
    expect(Object.keys(agyEntry?.tools ?? {}).sort()).toEqual([
      'lookup_corporate_by_number',
      'lookup_invoice_issuer',
      'normalize_company_name',
      'search_corporate_by_name',
      'validate_corporate_number',
    ]);
  });

  it('ensures Claude Code and Cursor MCP server configs point to the hosted /mcp endpoint', () => {
    const expectedUrl = `${PUBLIC_BASE_URL}/mcp`;
    expect(mcpJson.mcpServers['houjin-bangou']?.url).toBe(expectedUrl);
    expect(dotMcpJson.mcpServers['houjin-bangou']?.url).toBe(expectedUrl);
    expect(dotMcpJson.mcpServers['houjin-bangou']?.type).toBe('streamable-http');
    expect(cursorMcpJson.mcpServers['houjin-bangou']?.url).toBe(expectedUrl);
  });
});
