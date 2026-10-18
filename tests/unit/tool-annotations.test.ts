/**
 * tool-annotations ユニットテスト
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §1 (仕様 v1.8)
 * - 全ツールの静的アノテーション生成
 * - 照会ツール（3種）は Web-API版・DB版ともに openWorldHint: true
 * - 純粋関数ツール（2種）は外部通信を行わないため openWorldHint: false
 */

import { describe, it, expect } from 'vitest';
import { getToolAnnotations } from '../../src/domain/tool-annotations.js';

describe('getToolAnnotations', () => {
  it('returns valid annotations for all tools in web-api mode', () => {
    const lookup = getToolAnnotations('lookup_corporate_by_number', 'web-api');
    expect(lookup.readOnlyHint).toBe(true);
    expect(lookup.destructiveHint).toBe(false);
    expect(lookup.idempotentHint).toBe(true);
    expect(lookup.openWorldHint).toBe(true);

    const search = getToolAnnotations('search_corporate_by_name', 'web-api');
    expect(search.openWorldHint).toBe(true);

    const invoice = getToolAnnotations('lookup_invoice_issuer', 'web-api');
    expect(invoice.title).toBe('Look up Registered Invoice Issuer by T-number');
    expect(invoice.openWorldHint).toBe(true);

    const validate = getToolAnnotations('validate_corporate_number', 'web-api');
    expect(validate.openWorldHint).toBe(false);

    const normalize = getToolAnnotations('normalize_company_name', 'web-api');
    expect(normalize.openWorldHint).toBe(false);
  });

  it('returns openWorldHint=true for data lookup tools in db mode (specification v1.8)', () => {
    const lookup = getToolAnnotations('lookup_corporate_by_number', 'db');
    expect(lookup.openWorldHint).toBe(true);

    const search = getToolAnnotations('search_corporate_by_name', 'db');
    expect(search.openWorldHint).toBe(true);

    const invoice = getToolAnnotations('lookup_invoice_issuer', 'db');
    expect(invoice.title).toBe('Look up Registered Invoice Issuer by T-number');
    expect(invoice.openWorldHint).toBe(true);

    const validate = getToolAnnotations('validate_corporate_number', 'db');
    expect(validate.openWorldHint).toBe(false);

    const normalize = getToolAnnotations('normalize_company_name', 'db');
    expect(normalize.openWorldHint).toBe(false);
  });

  it('all tools have non-empty English titles', () => {
    const tools = [
      'lookup_corporate_by_number',
      'search_corporate_by_name',
      'lookup_invoice_issuer',
      'validate_corporate_number',
      'normalize_company_name',
    ] as const;

    for (const tool of tools) {
      const ann = getToolAnnotations(tool, 'web-api');
      expect(ann.title.length).toBeGreaterThan(0);
    }
  });
});
