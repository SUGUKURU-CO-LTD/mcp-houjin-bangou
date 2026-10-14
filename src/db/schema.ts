/**
 * Drizzle ORM Database Schema for Corporate Check MCP (Host Edition)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B4) 設計の制約:
 *     - テーブルは、法人番号・インボイス・データセットの版（データ源、data_as_of、取り込み日時、状態）の3つを基本にする
 *     - インボイスのテーブルに、個人事業者の氏名・屋号の列を作らない
 *     - 新しいデータは別の場所に取り込み、全件そろってから切り替える。途中で失敗した場合は、前のデータと前の data_as_of のまま動き続ける
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * 1. データセットの版管理テーブル
 *
 * データ源、data_as_of、取り込み日時、状態を保持する。
 * status: 'staging' (取り込み中) | 'active' (運用中) | 'superseded' (旧世代) | 'failed' (取り込み失敗)
 */
export const datasetVersions = pgTable(
  'dataset_versions',
  {
    id: serial('id').primaryKey(),
    sourceType: varchar('source_type', { length: 50 }).notNull(), // 'nta_corporate_download' | 'nta_invoice_download'
    dataAsOf: varchar('data_as_of', { length: 10 }).notNull(), // YYYY-MM-DD
    importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('staging'), // 'staging' | 'active' | 'superseded' | 'failed'
    recordCount: integer('record_count').notNull().default(0),
  },
  (table) => [index('idx_dataset_versions_source_status').on(table.sourceType, table.status)],
);

/**
 * 2. 法人番号テーブル (本番)
 * 国税庁 基本3情報ダウンロードCSV仕様に基づく公表法人情報
 */
export const corporateNumbers = pgTable(
  'corporate_numbers',
  {
    corporateNumber: varchar('corporate_number', { length: 13 }).notNull(),
    process: varchar('process', { length: 2 }), // 処理区分: 01:新規, 11:商号変更, 12:国内所在地変更, etc.
    correct: varchar('correct', { length: 1 }), // 訂正区分: 0:訂正以外, 1:訂正
    updateDate: varchar('update_date', { length: 10 }).notNull(), // 更新年月日 (YYYY-MM-DD)
    changeDate: varchar('change_date', { length: 10 }), // 変更年月日 (YYYY-MM-DD)
    name: varchar('name', { length: 300 }).notNull(), // 商号又は名称
    nameImageId: varchar('name_image_id', { length: 8 }), // 商号又は名称イメージID
    kind: varchar('kind', { length: 3 }).notNull(), // 法人種別 (101, 201, 301, etc.)
    prefectureName: varchar('prefecture_name', { length: 10 }), // 国内所在地（都道府県）
    cityName: varchar('city_name', { length: 20 }), // 国内所在地（市区町村）
    streetNumber: varchar('street_number', { length: 300 }), // 国内所在地（丁目番地等）
    addressImageId: varchar('address_image_id', { length: 8 }), // 国内所在地イメージID
    prefectureCode: varchar('prefecture_code', { length: 2 }), // 都道府県コード (01-47)
    cityCode: varchar('city_code', { length: 3 }), // 市区町村コード
    postCode: varchar('post_code', { length: 7 }), // 郵便番号
    addressOutside: varchar('address_outside', { length: 300 }), // 国外所在地
    addressOutsideImageId: varchar('address_outside_image_id', { length: 8 }),
    closeDate: varchar('close_date', { length: 10 }), // 登記記録の閉鎖等年月日 (YYYY-MM-DD)
    closeCause: varchar('close_cause', { length: 2 }), // 登記記録の閉鎖等の事由 (01, 11, 21, etc.)
    successorCorporateNumber: varchar('successor_corporate_number', { length: 13 }),
    changeCause: varchar('change_cause', { length: 500 }),
    assignmentDate: varchar('assignment_date', { length: 10 }), // 法人番号指定年月日 (YYYY-MM-DD)
    latest: varchar('latest', { length: 1 }).notNull().default('1'), // 最新履歴区分 (1:最新, 0:過去)
    enName: varchar('en_name', { length: 300 }),
    enPrefectureName: varchar('en_prefecture_name', { length: 50 }),
    enCityName: varchar('en_city_name', { length: 50 }),
    enAddressOutside: varchar('en_address_outside', { length: 300 }),
    furigana: varchar('furigana', { length: 500 }),
    hihyoji: varchar('hihyoji', { length: 1 }).notNull().default('0'), // 検索対象除外 (0: 検索対象, 1: 検索対象除外)
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.corporateNumber, table.datasetVersionId] }),
    index('idx_corporate_numbers_number').on(table.corporateNumber),
    index('idx_corporate_numbers_name').on(table.name),
    index('idx_corporate_numbers_name_trgm').using('gin', sql`${table.name} gin_trgm_ops`),
    index('idx_corporate_numbers_prefecture').on(table.prefectureCode),
    index('idx_corporate_numbers_version').on(table.datasetVersionId),
  ],
);

/**
 * 法人番号ステージングテーブル
 * 新しいデータを取り込み、全件検証が完了するまで一時保持する。
 */
export const corporateNumbersStaging = pgTable(
  'corporate_numbers_staging',
  {
    corporateNumber: varchar('corporate_number', { length: 13 }).notNull(),
    process: varchar('process', { length: 2 }),
    correct: varchar('correct', { length: 1 }),
    updateDate: varchar('update_date', { length: 10 }).notNull(),
    changeDate: varchar('change_date', { length: 10 }),
    name: varchar('name', { length: 300 }).notNull(),
    nameImageId: varchar('name_image_id', { length: 8 }),
    kind: varchar('kind', { length: 3 }).notNull(),
    prefectureName: varchar('prefecture_name', { length: 10 }),
    cityName: varchar('city_name', { length: 20 }),
    streetNumber: varchar('street_number', { length: 300 }),
    addressImageId: varchar('address_image_id', { length: 8 }),
    prefectureCode: varchar('prefecture_code', { length: 2 }),
    cityCode: varchar('city_code', { length: 3 }),
    postCode: varchar('post_code', { length: 7 }),
    addressOutside: varchar('address_outside', { length: 300 }),
    addressOutsideImageId: varchar('address_outside_image_id', { length: 8 }),
    closeDate: varchar('close_date', { length: 10 }),
    closeCause: varchar('close_cause', { length: 2 }),
    successorCorporateNumber: varchar('successor_corporate_number', { length: 13 }),
    changeCause: varchar('change_cause', { length: 500 }),
    assignmentDate: varchar('assignment_date', { length: 10 }),
    latest: varchar('latest', { length: 1 }).notNull().default('1'),
    enName: varchar('en_name', { length: 300 }),
    enPrefectureName: varchar('en_prefecture_name', { length: 50 }),
    enCityName: varchar('en_city_name', { length: 50 }),
    enAddressOutside: varchar('en_address_outside', { length: 300 }),
    furigana: varchar('furigana', { length: 500 }),
    hihyoji: varchar('hihyoji', { length: 1 }).notNull().default('0'), // 検索対象除外 (0: 検索対象, 1: 検索対象除外)
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.corporateNumber, table.datasetVersionId] })],
);

/**
 * 3. インボイス発行事業者テーブル (本番)
 *
 * 根拠・出典 / Source:
 *   - 国税庁 適格請求書発行事業者公表システム「リソース定義書（全件データ・差分データ）1.5版」（令和6年5月改訂）
 *     URL: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf （確認日: 2026-10-14）
 *     ダウンロードページ: https://www.invoice-kohyo.nta.go.jp/download/index.html （確認日: 2026-10-14）
 *   - 国税庁 お知らせ「全件データファイル及び差分データファイルの提供再開について（令和5年4月4日更新）」
 *     URL: https://www.invoice-kohyo.nta.go.jp/news/r04/r04news04.html （確認日: 2026-10-14）
 *
 * 【重要設計制約】
 *   1. リソース定義書1.5版（1.4版・令和4年12月改訂以降）では、令和4年9月26日から個人のダウンロードデータの
 *      項番21〜30（公表申出所在地・カナ・氏名又は名称・国内事業所所在地・主たる屋号・通称旧姓）は空文字で提供される。
 *   2. 本システムでは、人格区分（kind）が「1」（個人）の行、および区分が不明な行は、
 *      名称・所在地・カナ・屋号・通称を保持しない（パーサーで破棄し、テーブルにも主たる屋号・通称旧姓の列を作らない）。
 *      人格区分（kind）は「1: 個人」「2: 法人（人格のない社団等を含む）」の2種類（src/domain/invoice-codes.ts と一致）。
 *   3. 全件データは前月末時点の最新情報（履歴情報含む）であり、同一登録番号（registration_number）に対して
 *      最新行（latest='1'）と過去履歴行（latest='0'）の複数行が存在する。
 *      取引日時点の有効性判定に必要な登録・取消・失効の年月日を失わないよう、
 *      主キーを (registration_number, sequence_number, dataset_version_id) として全履歴行を保持する。
 */
export const invoiceIssuers = pgTable(
  'invoice_issuers',
  {
    sequenceNumber: varchar('sequence_number', { length: 8 }).notNull(), // 項番7 (CSV 1列目): 一連番号
    registrationNumber: varchar('registration_number', { length: 14 }).notNull(), // 項番8 (CSV 2列目): 登録番号 (T+13桁)
    process: varchar('process', { length: 2 }).notNull(), // 項番9 (CSV 3列目): 事業者処理区分 (01/02/03/04/99)
    correct: varchar('correct', { length: 1 }).notNull().default('0'), // 項番10 (CSV 4列目): 訂正区分 (0/1)
    kind: varchar('kind', { length: 2 }).notNull(), // 項番11 (CSV 5列目): 人格区分 (1:個人, 2:法人(人格のない社団等を含む))
    country: varchar('country', { length: 1 }), // 項番12 (CSV 6列目): 国内外区分 (1:国内, 2:特定国外, 3:その他国外)
    latest: varchar('latest', { length: 1 }).notNull().default('1'), // 項番13 (CSV 7列目): 最新履歴 (0:過去情報, 1:最新情報)
    registrationDate: varchar('registration_date', { length: 10 }).notNull(), // 項番14 (CSV 8列目): 登録年月日 (YYYY-MM-DD)
    updateDate: varchar('update_date', { length: 10 }).notNull(), // 項番15 (CSV 9列目): 更新年月日 (YYYY-MM-DD)
    cancelDate: varchar('cancel_date', { length: 10 }), // 項番16 (CSV 10列目): 取消年月日 (YYYY-MM-DD)
    expireDate: varchar('expire_date', { length: 10 }), // 項番17 (CSV 11列目): 失効年月日 (YYYY-MM-DD)
    headOfficeAddress: varchar('head_office_address', { length: 600 }), // 項番18 (CSV 12列目): 本店又は主たる事務所の所在地（法人）
    headOfficePrefectureCode: varchar('head_office_prefecture_code', { length: 2 }), // 項番19 (CSV 13列目): 都道府県コード（法人）
    headOfficeCityCode: varchar('head_office_city_code', { length: 3 }), // 項番20 (CSV 14列目): 市区町村コード（法人）
    declaredAddress: varchar('declared_address', { length: 600 }), // 項番21 (CSV 15列目): 本店又は主たる事務所の所在地（公表申出・人格のない社団等のみ保持）
    declaredPrefectureCode: varchar('declared_prefecture_code', { length: 2 }), // 項番22 (CSV 16列目): 都道府県コード（公表申出）
    declaredCityCode: varchar('declared_city_code', { length: 3 }), // 項番23 (CSV 17列目): 市区町村コード（公表申出）
    kana: varchar('kana', { length: 500 }), // 項番24 (CSV 18列目): 日本語（カナ）（kind='2'のみ保持）
    legalName: varchar('legal_name', { length: 300 }), // 項番25 (CSV 19列目): 氏名又は名称（kind='2'のみ保持、個人・区分不明はNULL）
    domesticOfficeAddress: varchar('domestic_office_address', { length: 600 }), // 項番26 (CSV 20列目): 国内事務所等の所在地（kind='2'のみ保持）
    domesticOfficePrefectureCode: varchar('domestic_office_prefecture_code', { length: 2 }), // 項番27 (CSV 21列目): 国内事務所等の都道府県コード
    domesticOfficeCityCode: varchar('domestic_office_city_code', { length: 3 }), // 項番28 (CSV 22列目): 国内事務所等の市区町村コード
    // 項番29 (CSV 23列目): 主たる屋号 — 個人用項目のため列を作らない
    // 項番30 (CSV 24列目): 通称・旧姓 — 個人用項目のため列を作らない
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({
      name: 'invoice_issuers_reg_num_seq_num_version_id_pk',
      columns: [table.registrationNumber, table.sequenceNumber, table.datasetVersionId],
    }),
    index('idx_invoice_issuers_reg_number').on(table.registrationNumber),
    index('idx_invoice_issuers_version').on(table.datasetVersionId),
  ],
);

/**
 * インボイス発行事業者ステージングテーブル
 */
export const invoiceIssuersStaging = pgTable(
  'invoice_issuers_staging',
  {
    sequenceNumber: varchar('sequence_number', { length: 8 }).notNull(),
    registrationNumber: varchar('registration_number', { length: 14 }).notNull(),
    process: varchar('process', { length: 2 }).notNull(),
    correct: varchar('correct', { length: 1 }).notNull().default('0'),
    kind: varchar('kind', { length: 2 }).notNull(),
    country: varchar('country', { length: 1 }),
    latest: varchar('latest', { length: 1 }).notNull().default('1'),
    registrationDate: varchar('registration_date', { length: 10 }).notNull(),
    updateDate: varchar('update_date', { length: 10 }).notNull(),
    cancelDate: varchar('cancel_date', { length: 10 }),
    expireDate: varchar('expire_date', { length: 10 }),
    headOfficeAddress: varchar('head_office_address', { length: 600 }),
    headOfficePrefectureCode: varchar('head_office_prefecture_code', { length: 2 }),
    headOfficeCityCode: varchar('head_office_city_code', { length: 3 }),
    declaredAddress: varchar('declared_address', { length: 600 }),
    declaredPrefectureCode: varchar('declared_prefecture_code', { length: 2 }),
    declaredCityCode: varchar('declared_city_code', { length: 3 }),
    kana: varchar('kana', { length: 500 }),
    legalName: varchar('legal_name', { length: 300 }),
    domesticOfficeAddress: varchar('domestic_office_address', { length: 600 }),
    domesticOfficePrefectureCode: varchar('domestic_office_prefecture_code', { length: 2 }),
    domesticOfficeCityCode: varchar('domestic_office_city_code', { length: 3 }),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({
      name: 'invoice_issuers_staging_reg_num_seq_num_version_id_pk',
      columns: [table.registrationNumber, table.sequenceNumber, table.datasetVersionId],
    }),
  ],
);
