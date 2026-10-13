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
 * 【重要設計制約】
 * 国税庁のダウンロードデータでは個人事業者の氏名等は削除されている（国税庁インボイスQ&A 問21）。
 * 念のため、パーサーでも除外している。
 * テーブルスキーマでも個人事業者の氏名・屋号の列は作成しない（設計レベルでの非保持）。
 * 法人・人格のない社団等の公表商号・所在地のみを保持する。
 *
 * 事業者区分（kind）の出典:
 * 国税庁適格請求書発行事業者公表システム「リソース定義書（全件データ・差分データ）」
 * （01: 法人、02: 個人事業者、03: 人格のない社団等）
 */
export const invoiceIssuers = pgTable(
  'invoice_issuers',
  {
    registrationNumber: varchar('registration_number', { length: 14 }).notNull(), // T + 13桁
    process: varchar('process', { length: 2 }), // 処理区分: 01:新規, etc.
    correct: varchar('correct', { length: 1 }), // 訂正区分
    kind: varchar('kind', { length: 2 }).notNull(), // 事業者区分 (01:法人, 02:個人事業者, 03:人格のない社団等)
    corporateNumber: varchar('corporate_number', { length: 13 }), // 法人番号 (法人のみ)
    legalName: varchar('legal_name', { length: 300 }), // 法人・人格のない社団等の公表名称 (個人事業者はNULL)
    prefectureName: varchar('prefecture_name', { length: 10 }), // 法人所在地（都道府県）
    cityName: varchar('city_name', { length: 20 }), // 法人所在地（市区町村）
    streetNumber: varchar('street_number', { length: 300 }), // 法人所在地（町名番地）
    postCode: varchar('post_code', { length: 7 }), // 郵便番号
    addressOutside: varchar('address_outside', { length: 300 }), // 国外所在地
    registrationDate: varchar('registration_date', { length: 10 }).notNull(), // 登録年月日 (YYYY-MM-DD)
    updateDate: varchar('update_date', { length: 10 }).notNull(), // 更新年月日 (YYYY-MM-DD)
    cancelDate: varchar('cancel_date', { length: 10 }), // 取消年月日 (YYYY-MM-DD)
    expireDate: varchar('expire_date', { length: 10 }), // 失効年月日 (YYYY-MM-DD)
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.registrationNumber, table.datasetVersionId] }),
    index('idx_invoice_issuers_reg_number').on(table.registrationNumber),
    index('idx_invoice_issuers_corp_number').on(table.corporateNumber),
    index('idx_invoice_issuers_version').on(table.datasetVersionId),
  ],
);

/**
 * インボイス発行事業者ステージングテーブル
 */
export const invoiceIssuersStaging = pgTable(
  'invoice_issuers_staging',
  {
    registrationNumber: varchar('registration_number', { length: 14 }).notNull(),
    process: varchar('process', { length: 2 }),
    correct: varchar('correct', { length: 1 }),
    kind: varchar('kind', { length: 2 }).notNull(),
    corporateNumber: varchar('corporate_number', { length: 13 }),
    legalName: varchar('legal_name', { length: 300 }),
    prefectureName: varchar('prefecture_name', { length: 10 }),
    cityName: varchar('city_name', { length: 20 }),
    streetNumber: varchar('street_number', { length: 300 }),
    postCode: varchar('post_code', { length: 7 }),
    addressOutside: varchar('address_outside', { length: 300 }),
    registrationDate: varchar('registration_date', { length: 10 }).notNull(),
    updateDate: varchar('update_date', { length: 10 }).notNull(),
    cancelDate: varchar('cancel_date', { length: 10 }),
    expireDate: varchar('expire_date', { length: 10 }),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.registrationNumber, table.datasetVersionId] })],
);
