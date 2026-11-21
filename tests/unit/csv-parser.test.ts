/**
 * CSV パーサーテスト
 * 根拠: 国税庁仕様書 第六編 §2.3.1 CSV サンプル
 */

import { describe, it, expect } from 'vitest';
import { parseNtaCsv, parseCsvLine } from '../../src/api/csv-parser.js';

describe('parseCsvLine', () => {
  it('通常フィールドをカンマ分割', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('ダブルクォート囲みフィールド', () => {
    expect(parseCsvLine('"a","b","c"')).toEqual(['a', 'b', 'c']);
  });

  it('ダブルクォート内のカンマ', () => {
    expect(parseCsvLine('"a,b","c"')).toEqual(['a,b', 'c']);
  });

  it('""エスケープ', () => {
    expect(parseCsvLine('"he said ""hi"""')).toEqual(['he said "hi"']);
  });

  it('空フィールド', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('末尾カンマ', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });
});

describe('parseNtaCsv', () => {
  it('ヘッダーのみの空レスポンス', () => {
    const csv = '2017-05-10,0,1,1\n';
    const result = parseNtaCsv(csv);
    expect(result.header.lastUpdateDate).toBe('2017-05-10');
    expect(result.header.count).toBe(0);
    expect(result.header.divideNumber).toBe(1);
    expect(result.header.divideSize).toBe(1);
    expect(result.corporations).toEqual([]);
  });

  it('仕様書 第六編 §2.3.1 ケース1 サンプル', () => {
    // 5111101000006 株式会社検索対象除外
    const csv = [
      '2019-04-05,1,1,1',
      '1,5111101000006,01,1,2019-04-03,2015-10-05,"株式会社検索対象除外",,301,"東京都","千代田区","（東京市神田区小川町一丁目１０番地）",,13,101,1000000,,,,,,,2015-10-05,1,,,,,,1',
    ].join('\n');
    const result = parseNtaCsv(csv);
    expect(result.header.count).toBe(1);
    expect(result.corporations.length).toBe(1);
    const c = result.corporations[0];
    expect(c?.corporate_number).toBe('5111101000006');
    expect(c?.process).toBe('01');
    expect(c?.name).toBe('株式会社検索対象除外');
    expect(c?.kind).toBe('301');
    expect(c?.prefecture_name).toBe('東京都');
    expect(c?.hihyoji).toBe('1');
  });

  it('複数行データ (商号変更履歴)', () => {
    const csv = [
      '2017-05-10,2,1,1',
      '1,8040001999013,01,0,2017-12-01,2015-10-05,"株式会社商号変更前",,301,"千葉県","千葉市中央区","蘇我５丁目９番１号",,12,101,2600822,,,,,,,2015-10-05,0,,,,,,0',
      '2,8040001999013,11,0,2017-05-09,2017-05-09,"株式会社商号変更後",,301,"千葉県","千葉市中央区","蘇我５丁目９番１号",,12,101,2600822,,,,,,,2015-10-05,1,,,,,,0',
    ].join('\n');
    const result = parseNtaCsv(csv);
    expect(result.header.count).toBe(2);
    expect(result.corporations.length).toBe(2);
    expect(result.corporations[0]?.name).toBe('株式会社商号変更前');
    expect(result.corporations[0]?.latest).toBe('0');
    expect(result.corporations[1]?.name).toBe('株式会社商号変更後');
    expect(result.corporations[1]?.latest).toBe('1');
  });

  it('CRLF 改行を扱う', () => {
    const csv = '2017-05-10,0,1,1\r\n';
    const result = parseNtaCsv(csv);
    expect(result.header.count).toBe(0);
  });

  it('空文字列は例外', () => {
    expect(() => parseNtaCsv('')).toThrow();
  });

  it('ページング: divideSize > 1 を正しく認識', () => {
    const csv = '2019-04-05,2500,1,2\n';
    const result = parseNtaCsv(csv);
    expect(result.header.divideNumber).toBe(1);
    expect(result.header.divideSize).toBe(2);
    expect(result.header.count).toBe(2500);
  });

  it('先頭に UTF-8 BOM (\\uFEFF) が付与されていても lastUpdateDate を正しくパースする', () => {
    const csv = '\uFEFF2026-10-31,0,1,1\n';
    const result = parseNtaCsv(csv);
    expect(result.header.lastUpdateDate).toBe('2026-10-31');
  });
});
