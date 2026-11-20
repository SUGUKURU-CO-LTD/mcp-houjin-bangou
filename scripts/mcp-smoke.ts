#!/usr/bin/env tsx
/**
 * MCP Smoke Runner
 *
 * 起動中の MCP サーバ (Streamable HTTP) に対して 5 tools + Resources +
 * Resource Templates + Prompts + Completion + Server Card + AI Catalog を
 * end-to-end で検証し、1件でも失敗があれば非ゼロ終了コードで終了する。
 *
 * 使い方:
 *   # Terminal 1
 *   NTA_APPLICATION_ID=dummy pnpm dev
 *
 *   # Terminal 2
 *   pnpm smoke [http://127.0.0.1:3001]
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

const endpoint = process.argv[2] ?? 'http://127.0.0.1:3001';
let failureCount = 0;

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
      'MCP-Protocol-Version': '2025-11-25',
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
  failureCount += 1;
  process.stderr.write(`\x1b[31m✗\x1b[0m ${label}\n  ${err}\n`);
}

async function main(): Promise<void> {
  process.stdout.write(`MCP Smoke Test: ${endpoint}\n\n`);

  // 1. /health
  try {
    const res = await fetch(`${endpoint}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { status: string; version: string };
    ok('health', `${json.status} / v${json.version}`);
  } catch (e) {
    bad('health', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // 2. Server Card & AI Catalog
  try {
    const res = await fetch(`${endpoint}/.well-known/mcp.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      name: string;
      version: string;
      primitives: { tools: string[]; resources: string[]; resource_templates: string[] };
    };
    const catRes = await fetch(`${endpoint}/.well-known/ai-catalog.json`);
    if (!catRes.ok) throw new Error(`AI Catalog HTTP ${catRes.status}`);
    ok(
      'server card + ai-catalog',
      `${json.name} v${json.version} — ${json.primitives.tools.length} tools, ${json.primitives.resources.length} resources, ${json.primitives.resource_templates.length} templates`,
    );
  } catch (e) {
    bad('server card + ai-catalog', e instanceof Error ? e.message : String(e));
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
    const r = res.result as {
      tools: Array<{
        name: string;
        inputSchema?: { additionalProperties?: boolean };
        _meta?: Record<string, unknown>;
      }>;
    };
    const names = r.tools.map((t) => t.name).join(', ');
    ok('tools/list', `${r.tools.length} tools: ${names}`);

    for (const tool of r.tools) {
      if (tool.inputSchema?.additionalProperties !== false) {
        throw new Error(`${tool.name} inputSchema missing additionalProperties: false`);
      }
    }

    const lookup = r.tools.find((t) => t.name === 'lookup_corporate_by_number');
    const search = r.tools.find((t) => t.name === 'search_corporate_by_name');
    const invoice = r.tools.find((t) => t.name === 'lookup_invoice_issuer');
    const lookupUi = (lookup?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri;
    const searchUi = (search?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri;
    const invoiceUi = (invoice?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri;
    if (lookupUi !== 'ui://corporate-card/mcp-app.html') {
      throw new Error(`lookup UI metadata mismatch: ${lookupUi ?? 'missing'}`);
    }
    if (searchUi !== 'ui://search-results/mcp-app.html') {
      throw new Error(`search UI metadata mismatch: ${searchUi ?? 'missing'}`);
    }
    if (invoiceUi !== 'ui://corporate-card/mcp-app.html') {
      throw new Error(`invoice UI metadata mismatch: ${invoiceUi ?? 'missing'}`);
    }
    ok('tools/list UI & strict schema metadata', `${lookupUi} / ${searchUi} / ${invoiceUi}`);
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

  // 7. validate_corporate_number (local, valid)
  try {
    const res = await rpc('tools/call', {
      name: 'validate_corporate_number',
      arguments: { corporate_number: '5111101000006' },
    });
    const r = res.result as {
      isError?: boolean;
      structuredContent: {
        is_valid_format: boolean;
        is_valid_check_digit: boolean;
        error_reason: string | null;
      };
    };
    if (r.isError || !r.structuredContent.is_valid_check_digit) {
      throw new Error('Expected valid check digit for 5111101000006');
    }
    ok(
      'tools/call validate_corporate_number(5111101000006)',
      `is_valid_format=${r.structuredContent.is_valid_format}, is_valid_check_digit=${r.structuredContent.is_valid_check_digit}`,
    );
  } catch (e) {
    bad('tools/call validate_corporate_number', e instanceof Error ? e.message : String(e));
  }

  // 8. validate_corporate_number (local, invalid check digit)
  try {
    const res = await rpc('tools/call', {
      name: 'validate_corporate_number',
      arguments: { corporate_number: '1111111111111' },
    });
    const r = res.result as {
      isError?: boolean;
      structuredContent: {
        is_valid_format: boolean;
        is_valid_check_digit: boolean;
        error_reason: string | null;
      };
    };
    if (r.isError || r.structuredContent.is_valid_check_digit) {
      throw new Error('Expected invalid check digit for 1111111111111');
    }
    ok(
      'tools/call validate_corporate_number(1111111111111, invalid)',
      `is_valid_check_digit=${r.structuredContent.is_valid_check_digit}, error_reason=${r.structuredContent.error_reason}`,
    );
  } catch (e) {
    bad('tools/call validate_corporate_number invalid', e instanceof Error ? e.message : String(e));
  }

  // 9. normalize_company_name
  try {
    const res = await rpc('tools/call', {
      name: 'normalize_company_name',
      arguments: { raw_name: '（株）髙橋商事' },
    });
    const r = res.result as {
      isError?: boolean;
      structuredContent: {
        normalized_name: string;
        legal_type: string | null;
        search_query_optimized: string;
      };
    };
    if (r.isError || !r.structuredContent.normalized_name) {
      throw new Error('normalize_company_name failed');
    }
    ok(
      'tools/call normalize_company_name(（株）髙橋商事)',
      `${r.structuredContent.normalized_name} (legal_type=${r.structuredContent.legal_type}, query=${r.structuredContent.search_query_optimized})`,
    );
  } catch (e) {
    bad('tools/call normalize_company_name', e instanceof Error ? e.message : String(e));
  }

  // 10. lookup_invoice_issuer (works in DB mode; returns clean DATA_UNAVAILABLE tool error in web-api mode)
  try {
    const res = await rpc('tools/call', {
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T9340001026142' },
    });
    const r = res.result as {
      isError?: boolean;
      structuredContent?: { status: string };
      _meta?: { error?: { code: string } };
    };
    if (r.isError) {
      const code = r._meta?.error?.code;
      if (code !== 'DATA_UNAVAILABLE') {
        throw new Error(`Unexpected invoice error code: ${code ?? 'unknown'}`);
      }
      ok('tools/call lookup_invoice_issuer (web-api mode)', `expected ${code}`);
    } else {
      ok(
        'tools/call lookup_invoice_issuer (db mode)',
        `status=${r.structuredContent?.status ?? 'unknown'}`,
      );
    }
  } catch (e) {
    bad('tools/call lookup_invoice_issuer', e instanceof Error ? e.message : String(e));
  }

  // 11. prompts/list
  try {
    const res = await rpc('prompts/list');
    const r = res.result as { prompts: Array<{ name: string }> };
    const names = r.prompts.map((p) => p.name).join(', ');
    ok('prompts/list', `${r.prompts.length} prompts: ${names}`);
  } catch (e) {
    bad('prompts/list', e instanceof Error ? e.message : String(e));
  }

  // 12. completion/complete (prompt argument)
  try {
    const res = await rpc('completion/complete', {
      ref: { type: 'ref/prompt', name: 'company-master-record' },
      argument: { name: 'company_name', value: '（株）スグクル' },
    });
    const r = res.result as { completion: { values: string[] } };
    if (r.completion.values.length === 0) {
      throw new Error('Expected non-empty completion values');
    }
    ok('completion/complete (prompt company_name)', r.completion.values.join(' / '));
  } catch (e) {
    bad('completion/complete', e instanceof Error ? e.message : String(e));
  }

  // 13. resources/read UI resource
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
    bad(
      'resources/read ui://corporate-card/mcp-app.html',
      e instanceof Error ? e.message : String(e),
    );
  }

  if (failureCount > 0) {
    process.stderr.write(`\nSmoke test FAILED (${failureCount} error(s)).\n`);
    process.exit(1);
  }

  process.stdout.write('\nSmoke test complete (all checks passed).\n');
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
