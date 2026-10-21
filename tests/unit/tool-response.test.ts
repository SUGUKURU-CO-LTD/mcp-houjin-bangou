import { describe, it, expect } from 'vitest';
import {
  formatAttributionLine,
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_INVOICE_HOST_ATTRIBUTION,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
} from '../../src/lib/tool-response.js';

describe('formatAttributionLine (SLA2-329)', () => {
  it('「出典：」で始まるホスト版の出典値は、二重に見出しを付けずそのまま返す', () => {
    expect(formatAttributionLine(NTA_CORPORATE_HOST_ATTRIBUTION)).toBe(
      NTA_CORPORATE_HOST_ATTRIBUTION,
    );
    expect(formatAttributionLine(NTA_INVOICE_HOST_ATTRIBUTION)).toBe(NTA_INVOICE_HOST_ATTRIBUTION);
    expect(formatAttributionLine('出典：テスト株式会社')).toBe('出典：テスト株式会社');
  });

  it('「出典：」で始まらない値には「出典: 」を前置する', () => {
    expect(formatAttributionLine(NTA_CORPORATE_WEB_API_ATTRIBUTION)).toBe(
      `出典: ${NTA_CORPORATE_WEB_API_ATTRIBUTION}`,
    );
    expect(formatAttributionLine('国税庁オープンデータ')).toBe('出典: 国税庁オープンデータ');
  });
});
