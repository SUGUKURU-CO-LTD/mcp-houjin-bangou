import { describe, it, expect } from 'vitest';
import {
  createSuccessResponse,
  createErrorResponse,
  formatAttributionLine,
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_INVOICE_HOST_ATTRIBUTION,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
} from '../../src/lib/tool-response.js';

describe('tool-response helpers', () => {
  describe('createErrorResponse (P0-1 SDK Client.callTool compatibility)', () => {
    it('omits structuredContent when isError is true and populates _meta.error + prefixed text', () => {
      const res = createErrorResponse('NOT_FOUND', '該当データなし');
      expect(res.isError).toBe(true);
      expect('structuredContent' in res).toBe(false);
      expect(res.structuredContent).toBeUndefined();
      expect(res.content).toEqual([
        {
          type: 'text',
          text: '[NOT_FOUND] 該当データなし',
        },
      ]);
      expect(res._meta).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: '該当データなし',
        },
      });
    });
  });

  describe('createSuccessResponse', () => {
    it('returns content summary and structuredContent without isError', () => {
      const res = createSuccessResponse('ok summary', { value: 42 });
      expect(res.isError).toBeUndefined();
      expect(res.content).toEqual([{ type: 'text', text: 'ok summary' }]);
      expect(res.structuredContent).toEqual({ value: 42 });
    });
  });

  describe('formatAttributionLine (SLA2-329)', () => {
    it('「出典：」で始まるホスト版の出典値は、二重に見出しを付けずそのまま返す', () => {
      expect(formatAttributionLine(NTA_CORPORATE_HOST_ATTRIBUTION)).toBe(
        NTA_CORPORATE_HOST_ATTRIBUTION,
      );
      expect(formatAttributionLine(NTA_INVOICE_HOST_ATTRIBUTION)).toBe(
        NTA_INVOICE_HOST_ATTRIBUTION,
      );
      expect(formatAttributionLine('出典：テスト株式会社')).toBe('出典：テスト株式会社');
    });

    it('「出典：」で始まらない値には「出典: 」を前置する', () => {
      expect(formatAttributionLine(NTA_CORPORATE_WEB_API_ATTRIBUTION)).toBe(
        `出典: ${NTA_CORPORATE_WEB_API_ATTRIBUTION}`,
      );
      expect(formatAttributionLine('国税庁オープンデータ')).toBe('出典: 国税庁オープンデータ');
    });
  });
});
