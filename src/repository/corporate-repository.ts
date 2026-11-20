/**
 * Corporate Data Provider Interface & Database Implementation
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1, §6.2 (v1.9 凍結仕様)
 *   実装指示書v1 §5(B4):
 *     - データ源の切り替え（ホスト版はDB、ローカル版はWeb-API）は、設定1か所で行う。
 *     - 名前検索の一致方式: 1〜2文字は前方一致、3文字以上は部分一致（半角/全角英数字の双方に一致）
 *     - 処理区分 '99'（削除）は検索・照会結果から除外
 *     - DB エラーログに入力値（\nparams:）を残さない
 */

import { eq, and, or, isNull, ne, like, ilike, inArray, notInArray, desc, asc } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { datasetVersions, corporateNumbers } from '../db/schema.js';
import { Result } from '../lib/result.js';
import { formatErrorWithCause } from '../lib/errors.js';
import { kindLabel } from '../domain/kind-codes.js';
import { closeCauseLabel } from '../domain/close-cause-codes.js';
import { applyOldToNew, hiraganaToKatakana, stripCorporateKind } from '../domain/normalizer.js';
import { encodeNameSearchCursor, validateNameSearchCursor } from '../lib/pagination.js';
import { NTA_CORPORATE_HOST_ATTRIBUTION } from '../lib/tool-response.js';

/**
 * PostgreSQL LIKE / ILIKE 検索用ワイルドカード文字のエスケープ
 * %, _, \ をエスケープして通常のリテラル文字として解釈させる。
 */
export function escapeLikeWildcards(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * 全角英数記号 (U+FF01..U+FF5E) を半角 ASCII (U+0021..U+007E) に変換する
 */
export function toHalfWidthAscii(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 半角 ASCII 英数記号 (U+0021..U+007E) を全角 (U+FF01..U+FF5E) に変換する
 */
export function toFullWidthAscii(input: string): string {
  return input.replace(/[\x21-\x7E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

/**
 * 商業登記・国税庁 CSV では英数字が全角・商号内空白が全角スペース (U+3000)（例: Ａｐｐｌｅ　Ｊａｐａｎ合同会社）で
 * 格納される一方、normalize_company_name (NFKC) や手入力では半角（Apple Japan、NTTデータ）になるため、
 * 半角または全角 ASCII を含む検索語は文字幅および空白幅 (U+0020 ⇔ U+3000) の双方のバリエーションを展開する。
 */
export function buildAsciiWidthSearchVariants(
  query: string,
  includeCaseVariantsForLike = false,
): string[] {
  const hasHalfAscii = /[\x21-\x7E]/.test(query);
  const hasFullAscii = /[\uFF01-\uFF5E]/.test(query);
  if (!hasHalfAscii && !hasFullAscii) {
    return [query];
  }

  const half = toHalfWidthAscii(query).replace(/\u3000/g, ' ');
  const halfUpper = half.toUpperCase();
  const halfLower = half.toLowerCase();
  const toFullWithSpace = (s: string): string => toFullWidthAscii(s).replace(/ /g, '\u3000');

  const variants = new Set<string>([
    query,
    half,
    toFullWithSpace(half),
    toFullWithSpace(halfUpper),
    toFullWithSpace(halfLower),
  ]);

  if (half.includes(' ')) {
    variants.add(half.replace(/ /g, '\u3000'));
    variants.add(toFullWidthAscii(half));
  }

  if (includeCaseVariantsForLike) {
    variants.add(halfUpper);
    variants.add(halfLower);
  }

  return Array.from(variants);
}

export const MAX_SEARCH_VARIANTS = 8;

const HIRAGANA_ONLY_PATTERN = /^(?=.*[\u3041-\u3096])[\u3041-\u3096\u30FC\s\u3000・ー]+$/u;

/**
 * 商業登記の旧かな表記（キヤノン、富士フイルム、キユーピー、シヤチハタ、チヨダ等）と
 * 一般入力の小書きカナを双方向に展開する連語ペア
 */
const SMALL_LARGE_KANA_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['キャ', 'キヤ'],
  ['キュ', 'キユ'],
  ['キョ', 'キヨ'],
  ['シャ', 'シヤ'],
  ['シュ', 'シユ'],
  ['ショ', 'シヨ'],
  ['チャ', 'チヤ'],
  ['チュ', 'チユ'],
  ['チョ', 'チヨ'],
  ['ジャ', 'ジヤ'],
  ['ジュ', 'ジユ'],
  ['ジョ', 'ジヨ'],
  ['ファ', 'フア'],
  ['フィ', 'フイ'],
  ['フェ', 'フエ'],
  ['フォ', 'フオ'],
  ['ティ', 'テイ'],
  ['ディ', 'デイ'],
];

/**
 * 商業登記で旧字体が正式商号として頻出する主要漢字の新字 → 旧字逆展開マップ
 * （例: 野村証券 → 野村證券、高橋 → 髙橋、川崎/山崎 → 山﨑、日本製鉄 → 日本製鐵）
 */
const COMMERCIAL_NEW_TO_OLD_KANJI: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['証', ['證']],
  ['高', ['髙']],
  ['崎', ['﨑']],
  ['斎', ['齋']],
  ['斉', ['齊']],
  ['浜', ['濱', '濵']],
  ['沢', ['澤']],
  ['広', ['廣']],
  ['桜', ['櫻']],
  ['辺', ['邊', '邉']],
  ['鉄', ['鐵']],
  ['国', ['國']],
  ['会', ['會']],
  ['栄', ['榮']],
  ['実', ['實']],
  ['寿', ['壽']],
  ['総', ['總']],
  ['島', ['嶋']],
  ['富', ['冨']],
  ['柳', ['栁']],
  ['徳', ['德']],
  ['真', ['眞']],
];

/**
 * DB 商号検索向けに、上限 (maxVariants) 付きで空白・英数全半角・ひらがな→カタカナ・
 * 小書きカナ双方向・旧字体/新字体双方向の検索パターンを展開する。
 * 3文字以上クエリ (!isShortQuery) では pg_trgm GIN 索引を確実に利用するため 3文字未満への縮退を除外する。
 */
export function buildSearchNameVariants(
  query: string,
  isShortQuery = false,
  maxVariants = MAX_SEARCH_VARIANTS,
): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const variants = new Set<string>();
  const addVariant = (candidate: string): void => {
    if (variants.size >= maxVariants) return;
    if (candidate.length === 0) return;
    if (!isShortQuery && candidate.length < 3) return;
    variants.add(candidate);
  };

  variants.add(trimmed);

  // 1. 旧字体 → 新字体
  const newForm = applyOldToNew(trimmed);
  addVariant(newForm);

  // 2. 英数全半角 & スペース (U+0020 ⇔ U+3000 / 中点 / 空白除去)
  for (const base of [trimmed, newForm]) {
    for (const w of buildAsciiWidthSearchVariants(base, isShortQuery)) {
      addVariant(w);
    }
    if (/[ \u3000]/.test(base)) {
      addVariant(base.replace(/[ \u3000]+/g, '\u3000'));
      addVariant(base.replace(/[ \u3000]+/g, ' '));
      addVariant(base.replace(/[ \u3000]+/g, '・'));
      addVariant(base.replace(/[ \u3000]+/g, ''));
    }
  }

  // 3. ひらがなのみのクエリ（または法人格を除いたコア名がひらがなのみ） → カタカナ併記
  if (HIRAGANA_ONLY_PATTERN.test(newForm)) {
    addVariant(hiraganaToKatakana(newForm));
  } else {
    const { core, hadKind } = stripCorporateKind(newForm);
    if (hadKind && core.length > 0 && HIRAGANA_ONLY_PATTERN.test(core)) {
      addVariant(newForm.replace(core, hiraganaToKatakana(core)));
    }
  }

  // 4. 小書きカナ ⇔ 大書きカナ 双方向展開（キャノン⇔キヤノン、富士フィルム⇔富士フイルム等）
  const kanaBases = Array.from(variants).slice(0, 3);
  for (const base of kanaBases) {
    let allToLarge = base;
    let allToSmall = base;
    for (const [smallDigraph, largeDigraph] of SMALL_LARGE_KANA_PAIRS) {
      if (base.includes(smallDigraph)) {
        addVariant(base.split(smallDigraph).join(largeDigraph));
        allToLarge = allToLarge.split(smallDigraph).join(largeDigraph);
      }
      if (base.includes(largeDigraph)) {
        addVariant(base.split(largeDigraph).join(smallDigraph));
        allToSmall = allToSmall.split(largeDigraph).join(smallDigraph);
      }
    }
    addVariant(allToLarge);
    addVariant(allToSmall);
  }

  // 5. 主要商業旧字体の新字 → 旧字 逆方向展開（野村証券→野村證券、高橋→髙橋等）
  let allPrimaryOld = newForm;
  let matchedKanjiGroups = 0;
  for (const [newChar, oldChars] of COMMERCIAL_NEW_TO_OLD_KANJI) {
    if (variants.size >= maxVariants) break;
    if (newForm.includes(newChar)) {
      matchedKanjiGroups += 1;
      const primaryOld = oldChars[0];
      if (primaryOld !== undefined) {
        allPrimaryOld = allPrimaryOld.split(newChar).join(primaryOld);
      }
      for (const oldChar of oldChars) {
        addVariant(newForm.split(newChar).join(oldChar));
      }
    }
  }
  if (matchedKanjiGroups >= 2) {
    addVariant(allPrimaryOld);
  }

  return Array.from(variants);
}

/**
 * B-tree 索引 `idx_corporate_numbers_name` で先行取得する完全一致候補名リストを生成する。
 * 3文字以上の部分一致検索では前後双方の代表法人格を補完し、1〜2文字の前方一致検索 (isShortQuery) では
 * 前方一致仕様（`LIKE 'prefix%'`）を守るため後株・完全一致のみに限定する。
 * 法人格のみの検索語（例: "株式会社"）では空配列を返して先行取得をスキップする。
 */
export function buildPriorityExactNames(
  trimmedName: string,
  variants: string[],
  isShortQuery = trimmedName.length <= 2,
): string[] {
  const { core, hadKind } = stripCorporateKind(trimmedName);
  if (core.length === 0) {
    return [];
  }

  const exactNames = new Set<string>();
  if (hadKind) {
    for (const v of variants) {
      exactNames.add(v);
    }
  } else {
    for (const v of variants.slice(0, 4)) {
      exactNames.add(v);
      exactNames.add(`${v}株式会社`);
      exactNames.add(`${v}合同会社`);
      exactNames.add(`${v}有限会社`);
      if (!isShortQuery) {
        exactNames.add(`株式会社${v}`);
        exactNames.add(`合同会社${v}`);
        exactNames.add(`有限会社${v}`);
      }
    }
  }

  return Array.from(exactNames).slice(0, 28);
}

interface RankableCorporateRow {
  corporateNumber: string;
  name: string;
  kind: string;
  closeDate?: string | null;
  closeCause?: string | null;
}

function comparePriorityCorporations(
  a: RankableCorporateRow,
  b: RankableCorporateRow,
  variants: ReadonlySet<string>,
): number {
  const aClosed = Boolean(a.closeDate || a.closeCause) ? 1 : 0;
  const bClosed = Boolean(b.closeDate || b.closeCause) ? 1 : 0;
  if (aClosed !== bClosed) {
    return aClosed - bClosed;
  }

  const rankKind = (row: RankableCorporateRow): number => {
    if (variants.has(row.name)) return 0;
    if (row.kind === '301') return 1; // 株式会社
    if (row.kind === '305') return 2; // 合同会社
    return 3;
  };
  const aRank = rankKind(a);
  const bRank = rankKind(b);
  if (aRank !== bRank) {
    return aRank - bRank;
  }

  return a.corporateNumber.localeCompare(b.corporateNumber);
}

/**
 * PostgreSQL クエリタイムアウト（エラーコード 57014: query_canceled）の判定
 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === '57014' ||
    (typeof e.message === 'string' &&
      (e.message.includes('statement timeout') || e.message.includes('canceling statement')))
  );
}

function writeCorporateRepositoryErrorLog(operation: string, err: unknown): void {
  const errorType = err instanceof Error ? err.name : 'UnknownError';
  const msg = formatErrorWithCause(err);
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      severity: 'ERROR',
      time: new Date().toISOString(),
      logger: 'corporate_repository',
      operation,
      error_type: errorType,
      msg,
    }) + '\n',
  );
}

export interface CorporationInfo {
  corporate_number: string;
  name: string;
  name_kana: string | null;
  legal_type: string;
  location: string;
  post_code: string | null;
  update_date: string;
  status: 'active' | 'closed';
  close_date: string | null;
  close_cause: string | null;
  successor_corporate_number?: string | null;
  successorCorporateNumber: string | null;
  address_may_be_outdated?: boolean;
}

export type CorporateRecord = CorporationInfo;

export interface LookupCorporateResult {
  corporation: CorporationInfo;
  data_as_of: string;
  attribution: string;
}

export interface SearchCorporationItem {
  corporate_number: string;
  name: string;
  legal_type: string;
  location: string;
  update_date: string;
  status: 'active' | 'closed';
  address_may_be_outdated?: boolean;
}

export interface SearchCorporateResult {
  results: SearchCorporationItem[];
  total_count?: number | null;
  next_cursor: string | null;
  data_as_of: string;
  attribution: string;
}

export interface CorporateError {
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DATA_UNAVAILABLE' | 'INTERNAL_ERROR';
  message: string;
}

export interface CorporateDataProvider {
  readonly mode: 'db' | 'web-api';
  lookupByNumber(corporateNumber: string): Promise<Result<LookupCorporateResult, CorporateError>>;
  searchByName(
    name: string,
    prefecture?: string,
    cursor?: string,
    limit?: number,
  ): Promise<Result<SearchCorporateResult, CorporateError>>;
}

/**
 * ホスト版: 自社 PostgreSQL データベースから公表法人情報を検索・取得するプロバイダー
 */
export class DbCorporateDataProvider implements CorporateDataProvider {
  readonly mode = 'db' as const;

  constructor(private db: DbClient) {}

  /**
   * 現在 active な最新の法人データセットバージョンを取得
   */
  private async getActiveVersion(): Promise<{ id: number; dataAsOf: string } | null> {
    const versions = await this.db
      .select({ id: datasetVersions.id, dataAsOf: datasetVersions.dataAsOf })
      .from(datasetVersions)
      .where(
        and(
          eq(datasetVersions.sourceType, 'nta_corporate_download'),
          eq(datasetVersions.status, 'active'),
        ),
      )
      .orderBy(desc(datasetVersions.importedAt))
      .limit(1);

    const first = versions[0];
    return first ?? null;
  }

  async lookupByNumber(
    corporateNumber: string,
  ): Promise<Result<LookupCorporateResult, CorporateError>> {
    try {
      const activeVersion = await this.getActiveVersion();
      if (!activeVersion) {
        return Result.err({
          code: 'INTERNAL_ERROR',
          message: 'Active corporate dataset not found in database',
        });
      }

      const rows = await this.db
        .select()
        .from(corporateNumbers)
        .where(
          and(
            eq(corporateNumbers.corporateNumber, corporateNumber),
            eq(corporateNumbers.datasetVersionId, activeVersion.id),
          ),
        )
        .limit(1);

      const row = rows[0];
      // 処理区分 '99'（削除）は公表対象外（削除済み）のため該当なし扱いとする
      if (!row || row.process === '99') {
        return Result.err({
          code: 'NOT_FOUND',
          message: `指定された法人番号 (${corporateNumber}) に該当する公表データは見つかりませんでした。`,
        });
      }

      const isClosed = Boolean(row.closeDate || row.closeCause);

      const locationParts = [
        row.prefectureName,
        row.cityName,
        row.streetNumber,
        row.addressOutside,
      ].filter(Boolean);
      const location = locationParts.join('') || '所在地不明';

      const successorVal =
        row.successorCorporateNumber && row.successorCorporateNumber.trim() !== ''
          ? row.successorCorporateNumber.trim()
          : null;

      const info = {
        corporate_number: row.corporateNumber,
        name: row.name,
        name_kana: row.furigana ?? null,
        legal_type: kindLabel(row.kind),
        location,
        post_code: row.postCode ?? null,
        update_date: row.updateDate,
        status: (isClosed ? 'closed' : 'active') as 'active' | 'closed',
        close_date: row.closeDate ?? null,
        close_cause: row.closeCause ? closeCauseLabel(row.closeCause) : null,
        ...(successorVal !== null ? { successor_corporate_number: successorVal } : {}),
        address_may_be_outdated: row.hihyoji === '1',
      } as CorporationInfo;

      // camelCase アクセサを非列挙プロパティとして定義し、strict OutputSchema (additionalProperties: false) と両立させる
      Object.defineProperty(info, 'successorCorporateNumber', {
        value: successorVal,
        enumerable: false,
        configurable: true,
        writable: true,
      });

      return Result.ok({
        corporation: info,
        data_as_of: activeVersion.dataAsOf,
        attribution: NTA_CORPORATE_HOST_ATTRIBUTION,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return Result.err({
          code: 'DATA_UNAVAILABLE',
          message: 'データベースの検索が上限時間を超過しました。時間をおいて再試行してください。',
        });
      }
      writeCorporateRepositoryErrorLog('lookupByNumber', err);
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      });
    }
  }

  async searchByName(
    name: string,
    prefecture?: string,
    cursor?: string,
    requestedLimit?: number,
  ): Promise<Result<SearchCorporateResult, CorporateError>> {
    try {
      const activeVersion = await this.getActiveVersion();
      if (!activeVersion) {
        return Result.err({
          code: 'INTERNAL_ERROR',
          message: 'Active corporate dataset not found in database',
        });
      }

      const trimmedName = name.trim();
      const queryKey = `${trimmedName}|${prefecture ?? ''}`;

      let offset = 0;
      if (cursor) {
        const validation = validateNameSearchCursor(cursor, activeVersion.dataAsOf, queryKey);
        if (!validation.valid) {
          return Result.err({
            code: 'INVALID_INPUT',
            message: validation.message,
          });
        }
        offset = validation.payload.offset;
      }

      // 1〜2文字の語は前方一致 (LIKE 'prefix%') で text_pattern_ops 索引を活用し、
      // 3文字以上の語は pg_trgm の部分一致 (ILIKE '%query%') を使用する。
      // 空白・英数全半角・ひらがな→カタカナ・小書きカナ・旧字体/新字体のバリエーションを最大8件で展開する。
      const isShortQuery = trimmedName.length <= 2;
      const variants = buildSearchNameVariants(trimmedName, isShortQuery);
      const variantConditions = variants.map((v) => {
        const escaped = escapeLikeWildcards(v);
        return isShortQuery
          ? like(corporateNumbers.name, `${escaped}%`)
          : ilike(corporateNumbers.name, `%${escaped}%`);
      });
      const firstVariantCondition =
        variantConditions[0] ??
        ilike(corporateNumbers.name, `%${escapeLikeWildcards(trimmedName)}%`);
      const nameCondition =
        variantConditions.length === 1
          ? firstVariantCondition
          : (or(...variantConditions) ?? firstVariantCondition);

      // 処理区分 '99'（削除）を除外（process が NULL の行は保持する）
      const notDeletedCondition = or(
        isNull(corporateNumbers.process),
        ne(corporateNumbers.process, '99'),
      );

      // 既定10件、最大20件。次ページの有無判定のために +1 件取得
      const limit = Math.min(Math.max(requestedLimit ?? 10, 1), 20);
      const fetchLimit = limit + 1;

      // Stage 1: B-tree 索引 `idx_corporate_numbers_name` による完全一致・代表法人格候補の先行取得
      // （存続法人・完全一致・株式会社を先頭に配置し、Stage 2 と重複排除してページング整合性を保つ）
      const priorityNames = buildPriorityExactNames(trimmedName, variants, isShortQuery);
      let stage1Rows: Array<typeof corporateNumbers.$inferSelect> = [];
      if (priorityNames.length > 0) {
        const stage1Conditions = [
          eq(corporateNumbers.datasetVersionId, activeVersion.id),
          ...(notDeletedCondition ? [notDeletedCondition] : []),
          inArray(corporateNumbers.name, priorityNames),
        ];
        if (prefecture) {
          stage1Conditions.push(eq(corporateNumbers.prefectureCode, prefecture));
        }

        const rawStage1 = await this.db
          .select()
          .from(corporateNumbers)
          .where(and(...stage1Conditions))
          .orderBy(asc(corporateNumbers.corporateNumber))
          .limit(100)
          .offset(0);

        const priorityNameSet = new Set(priorityNames);
        const variantSet = new Set(variants);
        stage1Rows = rawStage1
          .filter((r) => r.process !== '99' && priorityNameSet.has(r.name))
          .sort((a, b) => comparePriorityCorporations(a, b, variantSet));
      }

      const stage1Count = stage1Rows.length;
      const stage1Slice = offset < stage1Count ? stage1Rows.slice(offset, offset + fetchLimit) : [];
      const neededFromStage2 = fetchLimit - stage1Slice.length;

      let stage2ValidRows: Array<typeof corporateNumbers.$inferSelect> = [];
      if (neededFromStage2 > 0) {
        const stage2Offset = Math.max(0, offset - stage1Count);
        const stage1CorpNumbers = stage1Rows.map((r) => r.corporateNumber);
        const stage1CorpNumberSet = new Set(stage1CorpNumbers);

        const conditions = [
          eq(corporateNumbers.datasetVersionId, activeVersion.id),
          ...(notDeletedCondition ? [notDeletedCondition] : []),
          ...(stage1CorpNumbers.length > 0
            ? [notInArray(corporateNumbers.corporateNumber, stage1CorpNumbers)]
            : []),
          nameCondition,
        ];

        if (prefecture) {
          conditions.push(eq(corporateNumbers.prefectureCode, prefecture));
        }

        const fetchedRows = await this.db
          .select()
          .from(corporateNumbers)
          .where(and(...conditions))
          .orderBy(asc(corporateNumbers.corporateNumber))
          .limit(neededFromStage2)
          .offset(stage2Offset);

        // モック DB 環境への防御的フィルタ（実 DB では WHERE 句で既に除外済み）
        stage2ValidRows = fetchedRows.filter(
          (r) => r.process !== '99' && !stage1CorpNumberSet.has(r.corporateNumber),
        );
      }

      const validFetchedRows = [...stage1Slice, ...stage2ValidRows];

      const hasNext = validFetchedRows.length > limit;
      const rows = hasNext ? validFetchedRows.slice(0, limit) : validFetchedRows;

      const totalCount: number | null = hasNext ? null : offset + validFetchedRows.length;

      const items: SearchCorporationItem[] = rows.map((row) => {
        const isClosed = Boolean(row.closeDate || row.closeCause);
        const locationParts = [
          row.prefectureName,
          row.cityName,
          row.streetNumber,
          row.addressOutside,
        ].filter(Boolean);
        const location = locationParts.join('') || '所在地不明';

        return {
          corporate_number: row.corporateNumber,
          name: row.name,
          legal_type: kindLabel(row.kind),
          location,
          update_date: row.updateDate,
          status: isClosed ? 'closed' : 'active',
          address_may_be_outdated: row.hihyoji === '1',
        };
      });

      const next_cursor = hasNext
        ? encodeNameSearchCursor({
            offset: offset + limit,
            data_as_of: activeVersion.dataAsOf,
            queryKey,
          })
        : null;

      return Result.ok({
        results: items,
        total_count: totalCount,
        next_cursor,
        data_as_of: activeVersion.dataAsOf,
        attribution: NTA_CORPORATE_HOST_ATTRIBUTION,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return Result.err({
          code: 'DATA_UNAVAILABLE',
          message:
            'データベースの検索が上限時間を超過しました。検索条件を絞り込んで再試行してください。',
        });
      }
      writeCorporateRepositoryErrorLog('searchByName', err);
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      });
    }
  }
}
