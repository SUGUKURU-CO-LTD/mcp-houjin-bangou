#!/usr/bin/env tsx
/**
 * MCP Smoke Runner
 *
 * 起動中の MCP サーバ (Streamable HTTP) に対して 5 tools + Resources +
 * Resource Templates + Completion + Server Card を end-to-end で叩き、
 * 結果を人間が読みやすい表形式で出力する。
 *
 * 使い方:
 *   # Terminal 1
 *   NTA_APPLICATION_ID=dummy pnpm dev
 *
 *   # Terminal 2
 *   pnpm tsx scripts/mcp-smoke.ts [http://localhost:3001]
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const endpoint = process.argv[2] ?? 'http://localhost:3001';

async function rpc(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
  const body: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method,
    ...(params !== undefined && { params }),
  };
  const res = await fetch(`${endpoint}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as JsonRpcResponse;
}

function ok(label: string, detail: string): void {
  process.stdout.write(`\x1b[32m✓\x1b[0m ${label}\n  ${detail}\n`);
}
function bad(label: string, err: string): void {
  process.stderr.write(`\x1b[31m✗\x1b[0m ${label}\n  ${err}\n`);
}

async function main(): Promise<void> {
  process.stdout.write(`MCP Smoke Test: ${endpoint}\n\n`);

  // 1. /health
  try {
    const res = await fetch(`${endpoint}/health`);
    const json = (await res.json()) as { status: string; version: string };
    ok('health', `${json.status} / v${json.version}`);
  } catch (e) {
    bad('health', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // 2. Server Card
  try {
    const res = await fetch(`${endpoint}/.well-known/mcp.json`);
    const json = (await res.json()) as {
      name: string;
      version: string;
      primitives: { tools: string[]; resources: string[]; resource_templates: string[] };
    };
    ok(
      'server card',
      `${json.name} v${json.version} — ${json.primitives.tools.length} tools, ${json.primitives.resources.length} resources, ${json.primitives.resource_templates.length} templates`,
    );
  } catch (e) {
    bad('server card', e instanceof Error ? e.message : String(e));
  }

  // 3. initialize
  try {
    const res = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1.0' },
    });
    const r = res.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
    };
    ok('initialize', `proto=${r.protocolVersion}, caps=${Object.keys(r.capabilities).join(',')}`);
  } catch (e) {
    bad('initialize', e instanceof Error ? e.message : String(e));
  }

  // 4. tools/list
  try {
    const res = await rpc('tools/list');
    const r = res.result as { tools: Array<{ name: string; _meta?: Record<string, unknown> }> };
    const names = r.tools.map((t) => t.name).join(', ');
    ok('tools/list', `${r.tools.length} tools: ${names}`);

    const lookup = r.tools.find((t) => t.name === 'lookup_corporate_by_number');
    const search = r.tools.find((t) => t.name === 'search_corporate_by_name');
    const lookupUi = (lookup?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri;
    const searchUi = (search?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri;
    if (lookupUi !== 'ui://corporate-card/mcp-app.html') {
      throw new Error(`lookup UI metadata mismatch: ${lookupUi ?? 'missing'}`);
    }
    if (searchUi !== 'ui://search-results/mcp-app.html') {
      throw new Error(`search UI metadata mismatch: ${searchUi ?? 'missing'}`);
    }
    ok('tools/list UI metadata', `${lookupUi} / ${searchUi}`);
  } catch (e) {
    bad('tools/list', e instanceof Error ? e.message : String(e));
  }

  // 5. resources/list
  try {
    const res = await rpc('resources/list');
    const r = res.result as { resources: Array<{ uri: string }> };
    const uris = r.resources.map((x) => x.uri).join(', ');
    ok('resources/list', `${r.resources.length}: ${uris}`);
  } catch (e) {
    bad('resources/list', e instanceof Error ? e.message : String(e));
  }

  // 6. resources/templates/list
  try {
    const res = await rpc('resources/templates/list');
    const r = res.result as { resourceTemplates: Array<{ uriTemplate: string }> };
    const t = r.resourceTemplates.map((x) => x.uriTemplate).join(', ');
    ok('resources/templates/list', `${r.resourceTemplates.length}: ${t}`);
  } catch (e) {
    bad('resources/templates/list', e instanceof Error ? e.message : String(e));
  }

  // 7. validate_corporate_number (local, no API)
  try {
    const res = await rpc('tools/call', {
      name: 'validate_corporate_number',
      arguments: { corporate_number: '5111101000006' },
    });
    const r = res.result as {
      structuredContent: { is_valid: boolean; normalized_number: string | null };
    };
    ok(
      'tools/call validate_corporate_number(5111101000006)',
      `is_valid=${r.structuredContent.is_valid}, normalized_number=${r.structuredContent.normalized_number}`,
    );
  } catch (e) {
    bad('tools/call validate_corporate_number', e instanceof Error ? e.message : String(e));
  }

  // 8. validate_corporate_number invalid
  try {
    const res = await rpc('tools/call', {
      name: 'validate_corporate_number',
      arguments: { corporate_number: '1111111111111' },
    });
    const r = res.result as { structuredContent: { is_valid: boolean; reason: string } };
    ok(
      'tools/call validate_corporate_number(1111111111111, invalid)',
      `is_valid=${r.structuredContent.is_valid}, reason=${r.structuredContent.reason}`,
    );
  } catch (e) {
    bad('tools/call validate_corporate_number invalid', e instanceof Error ? e.message : String(e));
  }

  // 9. normalize_company_name
  try {
    const res = await rpc('tools/call', {
      name: 'normalize_company_name',
      arguments: { raw_input: '（株）高橋商事' },
    });
    const r = res.result as {
      structuredContent: { candidates: Array<{ name: string }> };
    };
    const names = r.structuredContent.candidates.map((c) => c.name).join(' / ');
    ok('tools/call normalize_company_name(（株）高橋商事)', names);
  } catch (e) {
    bad('tools/call normalize_company_name', e instanceof Error ? e.message : String(e));
  }

  // 10. prompts/list
  try {
    const res = await rpc('prompts/list');
    const r = res.result as { prompts: Array<{ name: string }> };
    const names = r.prompts.map((p) => p.name).join(', ');
    ok('prompts/list', `${r.prompts.length} prompts: ${names}`);
  } catch (e) {
    bad('prompts/list', e instanceof Error ? e.message : String(e));
  }

  // 11. completion/complete (prompt argument)
  try {
    const res = await rpc('completion/complete', {
      ref: { type: 'ref/prompt', name: 'company-master-record' },
      argument: { name: 'company_name', value: '（株）スグクル' },
    });
    const r = res.result as { completion: { values: string[] } };
    ok('completion/complete (prompt company_name)', r.completion.values.join(' / '));
  } catch (e) {
    bad('completion/complete', e instanceof Error ? e.message : String(e));
  }

  // 12. resources/read UI resource
  try {
    const res = await rpc('resources/read', { uri: 'ui://corporate-card/mcp-app.html' });
    const r = res.result as { contents: Array<{ uri: string; mimeType: string; text: string }> };
    const first = r.contents[0];
    if (first === undefined) throw new Error('empty');
    ok(
      'resources/read ui://corporate-card/mcp-app.html',
      `mimeType=${first.mimeType}, bytes=${first.text.length}`,
    );
  } catch (e) {
    bad('resources/read ui://corporate-card/mcp-app.html', e instanceof Error ? e.message : String(e));
  }

  process.stdout.write('\nSmoke test complete.\n');
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
