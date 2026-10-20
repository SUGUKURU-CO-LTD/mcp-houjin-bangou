import { describe, it, expect } from 'vitest';
import { corporateNumbers, corporateNumbersStaging } from '../../src/db/schema.js';
import { corporateNumbersNew } from '../../src/ingest/importer.js';

/**
 * 国税庁「リソース定義書（ダウンロードファイル、Web-API）4.0版」に基づく法人番号テーブルの列長テスト
 *
 * 出典 / Source:
 *   国税庁 法人番号公表サイト「リソース定義書（ダウンロードファイル、Web-API）4.0版」（令和6年3月改訂）
 *   https://www.houjin-bangou.nta.go.jp/documents/k-resource-dl-ver4.pdf
 *   (ダウンロードファイル仕様: https://www.houjin-bangou.nta.go.jp/download/zenken/index.html)
 *
 * 各項番と仕様上の最大文字数:
 *   - 項番13 name (商号又は名称): 150文字 (schema >= 150)
 *   - 項番18 street_number (国内所在地（丁目番地等）): 300文字 (schema >= 300)
 *   - 項番23 address_outside (国外所在地): 300文字 (schema >= 300)
 *   - 項番28 change_cause (変更事由等): 500文字 (schema >= 500)
 *   - 項番31 en_name (商号又は名称（英語表記）): 300文字 (schema >= 300)
 *   - 項番32 en_prefecture_name (国内所在地（都道府県）（英語表記）): 9文字 (schema >= 9)
 *   - 項番33 en_city_name (国内所在地（市区町村丁目番地等）（英語表記）): 600文字 (schema >= 600)
 *   - 項番34 en_address_outside (国外所在地（英語表記）): 600文字 (schema >= 600)
 *   - 項番35 furigana (フリガナ): 500文字 (schema >= 500)
 */
describe('Corporate numbers column length specifications (Resource Definition ver 4.0)', () => {
  const tables = [
    { name: 'corporateNumbers', table: corporateNumbers },
    { name: 'corporateNumbersStaging', table: corporateNumbersStaging },
    { name: 'corporateNumbersNew', table: corporateNumbersNew },
  ];

  for (const { name, table } of tables) {
    describe(`table: ${name}`, () => {
      it('項番13: name should be at least 150 characters', () => {
        expect((table.name as unknown as { length?: number }).length).toBeGreaterThanOrEqual(150);
      });

      it('項番18: street_number should be at least 300 characters', () => {
        expect(
          (table.streetNumber as unknown as { length?: number }).length,
        ).toBeGreaterThanOrEqual(300);
      });

      it('項番23: address_outside should be at least 300 characters', () => {
        expect(
          (table.addressOutside as unknown as { length?: number }).length,
        ).toBeGreaterThanOrEqual(300);
      });

      it('項番28: change_cause should be at least 500 characters', () => {
        expect((table.changeCause as unknown as { length?: number }).length).toBeGreaterThanOrEqual(
          500,
        );
      });

      it('項番31: en_name should be at least 300 characters', () => {
        expect((table.enName as unknown as { length?: number }).length).toBeGreaterThanOrEqual(300);
      });

      it('項番32: en_prefecture_name should be at least 9 characters', () => {
        expect(
          (table.enPrefectureName as unknown as { length?: number }).length,
        ).toBeGreaterThanOrEqual(9);
      });

      it('項番33: en_city_name should be at least 600 characters', () => {
        expect((table.enCityName as unknown as { length?: number }).length).toBeGreaterThanOrEqual(
          600,
        );
      });

      it('項番34: en_address_outside should be at least 600 characters', () => {
        expect(
          (table.enAddressOutside as unknown as { length?: number }).length,
        ).toBeGreaterThanOrEqual(600);
      });

      it('項番35: furigana should be at least 500 characters', () => {
        expect((table.furigana as unknown as { length?: number }).length).toBeGreaterThanOrEqual(
          500,
        );
      });
    });
  }
});
