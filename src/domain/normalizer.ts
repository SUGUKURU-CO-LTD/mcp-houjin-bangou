/**
 * 表記揺れ正規化 (T7 の核)
 * Company name normalization (T7 core logic)
 *
 * ポジショニング / Positioning:
 *   国税庁 API `target=1` が既にあいまい検索を内蔵する (第二編 §4.6.2):
 *     - ひらがな → カタカナ置換
 *     - 英小文字 → 英大文字置換
 *     - 中点 (・) や全角スペース削除
 *
 *   T7 は国税庁 API およびホスト版 DB 検索の双方に対して決定論的な正規化を提供する:
 *     1. (株)/㈱/(有)/(同)/(一社)/(医) 等の略称展開 + 前株・後株・省略の展開
 *     2. 全主要な日本の法人種別（会社・一般/公益法人・医療/学校/社会福祉/宗教・士業・組合・金庫等）の最長一致検出と分離
 *     3. 英語法人名 → 日本語/英語検索候補 (K.K. / Kabushiki Kaisha / Co.,Ltd. / Inc. / LLC / G.K. 等)
 *     4. 半角/全角英数字・合字の正規化 (NFKC)
 *     5. 旧字体 → 新字体 (髙→高、齋→斎、證→証、會→会 等、旧字候補も併存)
 *     6. 異体字セレクタ (IVS / VS) 除去
 *     7. 空白類の揃え (タブ・連続スペース・全角/半角スペース)
 *     8. カタカナ語中のハイフン誤記 → 長音符 (ー) 補正および中点除去候補
 */

export type KindHint =
  | 'state_agency'
  | 'local_government'
  | 'kabushiki_kaisha'
  | 'yugen_kaisha'
  | 'gomei_kaisha'
  | 'goshi_kaisha'
  | 'godo_kaisha'
  | 'ippan_shadan_hojin'
  | 'ippan_zaidan_hojin'
  | 'koueki_shadan_hojin'
  | 'koueki_zaidan_hojin'
  | 'npo_hojin'
  | 'other_registered'
  | 'foreign_company'
  | 'other'
  | 'unknown';

export type CorporateLegalType = KindHint;

export type PrefixOrSuffix = 'mae_kabu' | 'ato_kabu' | 'none';

export interface NormalizedCandidate {
  /** 国税庁 API / DB に投げる法人名候補 */
  name: string;
  /** 推定される法人種別 */
  kind_hint: KindHint;
  /** 法人種別の位置 (前株/後株/無し) */
  prefix_or_suffix: PrefixOrSuffix;
  /** 国税庁 API の target パラメータ推奨値 */
  suggested_target: '1' | '2' | '3';
  /** 信頼度 (0.0-1.0) */
  confidence: number;
  /** このルールで適用された補完パターン */
  applied_rules: string[];
}

export interface NormalizerResult {
  original: string;
  extracted_core_name: string;
  normalized_candidates: NormalizedCandidate[];
  fallback_note?: string;
}

/**
 * 旧字体 → 新字体 辞書 (JIS 第一・第二水準への縮退補助)
 * 根拠: 法務省「戸籍統一文字」「人名用漢字の新字旧字対応表」および商業登記頻出字
 *
 * 商業登記では旧字体が正式商号である法人（例: 野村證券株式会社）も多いため、
 * 新字体変換後の候補に加えて元の旧字体候補も併存させる。
 */
const OLD_TO_NEW: Record<string, string> = {
  髙: '高',
  﨑: '崎',
  𠮷: '吉',
  齋: '斎',
  齊: '斉',
  濵: '浜',
  濱: '浜',
  德: '徳',
  眞: '真',
  曻: '昇',
  晄: '晃',
  淸: '清',
  廣: '広',
  禮: '礼',
  藪: '薮',
  邉: '辺',
  邊: '辺',
  澤: '沢',
  國: '国',
  團: '団',
  寳: '宝',
  寶: '宝',
  應: '応',
  靑: '青',
  權: '権',
  氣: '気',
  專: '専',
  單: '単',
  學: '学',
  樂: '楽',
  劍: '剣',
  續: '続',
  圖: '図',
  鐵: '鉄',
  齒: '歯',
  歷: '歴',
  藝: '芸',
  戰: '戦',
  驛: '駅',
  檢: '検',
  營: '営',
  舊: '旧',
  醫: '医',
  號: '号',
  獨: '独',
  讀: '読',
  變: '変',
  體: '体',
  會: '会',
  社: '社',
  證: '証',
  栁: '柳',
  櫻: '桜',
  冨: '富',
  峯: '峰',
  嶋: '島',
  嶌: '島',
  萬: '万',
  圓: '円',
  榮: '栄',
  實: '実',
  壽: '寿',
  總: '総',
  澁: '渋',
  澀: '渋',
  關: '関',
  纖: '繊',
  藥: '薬',
  釀: '醸',
  麴: '麹',
  龍: '竜',
  兒: '児',
  鑄: '鋳',
  鑛: '鉱',
  桒: '桑',
};

interface KindKeywordEntry {
  word: string;
  canonical: string;
  hint: KindHint;
  /** 前株↔後株（前付け↔後付け）の反転候補を生成するか */
  invertible?: boolean;
  /** KindHint が単一の法人格文字列と 1:1 対応するか（normalize-company-name ツール互換用） */
  exactHintLabel?: boolean;
}

/**
 * 日本の法人種別・略称キーワード定義（NFKC 適用後の文字列で照合）
 * ※ NFKC により `（株）` / `㈱` → `(株)`、`（有）` / `㈲` → `(有)`、`㍿` → `株式会社` 等は事前変換される。
 */
const RAW_KIND_KEYWORDS_JA: ReadonlyArray<KindKeywordEntry> = [
  // 会社法・特例有限会社・相互会社 (前付け・後付け両対応)
  {
    word: '株式会社',
    canonical: '株式会社',
    hint: 'kabushiki_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '(株)',
    canonical: '株式会社',
    hint: 'kabushiki_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '特例有限会社',
    canonical: '有限会社',
    hint: 'yugen_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '有限会社',
    canonical: '有限会社',
    hint: 'yugen_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '(有)',
    canonical: '有限会社',
    hint: 'yugen_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '合同会社',
    canonical: '合同会社',
    hint: 'godo_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '(同)',
    canonical: '合同会社',
    hint: 'godo_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '合名会社',
    canonical: '合名会社',
    hint: 'gomei_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '(名)',
    canonical: '合名会社',
    hint: 'gomei_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '合資会社',
    canonical: '合資会社',
    hint: 'goshi_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  {
    word: '(資)',
    canonical: '合資会社',
    hint: 'goshi_kaisha',
    invertible: true,
    exactHintLabel: true,
  },
  { word: '相互会社', canonical: '相互会社', hint: 'other_registered', invertible: true },
  { word: '(相)', canonical: '相互会社', hint: 'other_registered', invertible: true },

  // 一般・公益社団/財団法人・NPO法人
  {
    word: '一般社団法人',
    canonical: '一般社団法人',
    hint: 'ippan_shadan_hojin',
    exactHintLabel: true,
  },
  { word: '(一社)', canonical: '一般社団法人', hint: 'ippan_shadan_hojin', exactHintLabel: true },
  {
    word: '一般財団法人',
    canonical: '一般財団法人',
    hint: 'ippan_zaidan_hojin',
    exactHintLabel: true,
  },
  { word: '(一財)', canonical: '一般財団法人', hint: 'ippan_zaidan_hojin', exactHintLabel: true },
  {
    word: '公益社団法人',
    canonical: '公益社団法人',
    hint: 'koueki_shadan_hojin',
    exactHintLabel: true,
  },
  { word: '(公社)', canonical: '公益社団法人', hint: 'koueki_shadan_hojin', exactHintLabel: true },
  {
    word: '公益財団法人',
    canonical: '公益財団法人',
    hint: 'koueki_zaidan_hojin',
    exactHintLabel: true,
  },
  { word: '(公財)', canonical: '公益財団法人', hint: 'koueki_zaidan_hojin', exactHintLabel: true },
  {
    word: '特定非営利活動法人',
    canonical: '特定非営利活動法人',
    hint: 'npo_hojin',
    exactHintLabel: true,
  },
  { word: 'NPO法人', canonical: '特定非営利活動法人', hint: 'npo_hojin', exactHintLabel: true },
  { word: '(特非)', canonical: '特定非営利活動法人', hint: 'npo_hojin', exactHintLabel: true },

  // 医療・学校・社会福祉・宗教・更生保護法人 (最長一致順で医療法人社団/財団を先に判定)
  { word: '医療法人社団', canonical: '医療法人社団', hint: 'other_registered' },
  { word: '(医社)', canonical: '医療法人社団', hint: 'other_registered' },
  { word: '医療法人財団', canonical: '医療法人財団', hint: 'other_registered' },
  { word: '(医財)', canonical: '医療法人財団', hint: 'other_registered' },
  { word: '社会医療法人', canonical: '社会医療法人', hint: 'other_registered' },
  { word: '医療法人', canonical: '医療法人', hint: 'other_registered' },
  { word: '(医)', canonical: '医療法人', hint: 'other_registered' },
  { word: '学校法人', canonical: '学校法人', hint: 'other_registered' },
  { word: '(学)', canonical: '学校法人', hint: 'other_registered' },
  { word: '社会福祉法人', canonical: '社会福祉法人', hint: 'other_registered' },
  { word: '(福)', canonical: '社会福祉法人', hint: 'other_registered' },
  { word: '宗教法人', canonical: '宗教法人', hint: 'other_registered' },
  { word: '(宗)', canonical: '宗教法人', hint: 'other_registered' },
  { word: '更生保護法人', canonical: '更生保護法人', hint: 'other_registered' },

  // 国立/公立大学・独立行政法人
  { word: '国立大学法人', canonical: '国立大学法人', hint: 'other_registered' },
  { word: '公立大学法人', canonical: '公立大学法人', hint: 'other_registered' },
  { word: '地方独立行政法人', canonical: '地方独立行政法人', hint: 'other_registered' },
  { word: '独立行政法人', canonical: '独立行政法人', hint: 'other_registered' },
  { word: '(独)', canonical: '独立行政法人', hint: 'other_registered' },

  // 士業法人 (有限責任監査法人を監査法人より先に判定)
  { word: '社会保険労務士法人', canonical: '社会保険労務士法人', hint: 'other_registered' },
  { word: '土地家屋調査士法人', canonical: '土地家屋調査士法人', hint: 'other_registered' },
  { word: '有限責任監査法人', canonical: '有限責任監査法人', hint: 'other_registered' },
  { word: '司法書士法人', canonical: '司法書士法人', hint: 'other_registered' },
  { word: '行政書士法人', canonical: '行政書士法人', hint: 'other_registered' },
  { word: '特許業務法人', canonical: '特許業務法人', hint: 'other_registered' },
  { word: '弁護士法人', canonical: '弁護士法人', hint: 'other_registered' },
  { word: '税理士法人', canonical: '税理士法人', hint: 'other_registered' },
  { word: '弁理士法人', canonical: '弁理士法人', hint: 'other_registered' },
  { word: '監査法人', canonical: '監査法人', hint: 'other_registered' },

  // 金融・金庫・組合・投資法人
  { word: '商店街振興組合', canonical: '商店街振興組合', hint: 'other_registered' },
  { word: '農業協同組合', canonical: '農業協同組合', hint: 'other_registered' },
  { word: '漁業協同組合', canonical: '漁業協同組合', hint: 'other_registered' },
  { word: '生活協同組合', canonical: '生活協同組合', hint: 'other_registered' },
  { word: '事業協同組合', canonical: '事業協同組合', hint: 'other_registered' },
  { word: '管理組合法人', canonical: '管理組合法人', hint: 'other_registered' },
  { word: '信用金庫', canonical: '信用金庫', hint: 'other_registered' },
  { word: '(信金)', canonical: '信用金庫', hint: 'other_registered' },
  { word: '信用組合', canonical: '信用組合', hint: 'other_registered' },
  { word: '(信組)', canonical: '信用組合', hint: 'other_registered' },
  { word: '労働金庫', canonical: '労働金庫', hint: 'other_registered' },
  { word: '協同組合', canonical: '協同組合', hint: 'other_registered' },
  { word: '企業組合', canonical: '企業組合', hint: 'other_registered' },
  { word: '協業組合', canonical: '協業組合', hint: 'other_registered' },
  { word: '商工組合', canonical: '商工組合', hint: 'other_registered' },
  { word: '投資法人', canonical: '投資法人', hint: 'other_registered' },
];

/** 文字数降順（最長一致優先）でソート済みの法人種別辞書 */
const KIND_KEYWORDS_JA: ReadonlyArray<KindKeywordEntry> = [...RAW_KIND_KEYWORDS_JA].sort(
  (a, b) => b.word.length - a.word.length,
);

const EN_SUFFIX_PATTERNS: Array<{ regex: RegExp; hint: KindHint }> = [
  { regex: /\b(K\.?\s*K\.?)\b/gi, hint: 'kabushiki_kaisha' },
  { regex: /\bKabushiki\s*Kaisha\b/gi, hint: 'kabushiki_kaisha' },
  { regex: /\bGodo\s*Kaisha\b/gi, hint: 'godo_kaisha' },
  { regex: /\b(G\.?\s*K\.?)\b/gi, hint: 'godo_kaisha' },
  { regex: /\bCo\.?\s*,?\s*Ltd\.?\b/gi, hint: 'kabushiki_kaisha' },
  { regex: /\bCorporation\b/gi, hint: 'other_registered' },
  { regex: /\bCorp\.?\b/gi, hint: 'other_registered' },
  { regex: /\bIncorporated\b/gi, hint: 'foreign_company' },
  { regex: /\bInc\.?\b/gi, hint: 'foreign_company' },
  { regex: /\bLimited\b/gi, hint: 'other_registered' },
  { regex: /\bLtd\.?\b/gi, hint: 'other_registered' },
  { regex: /\bLLC\b/gi, hint: 'godo_kaisha' },
];

/**
 * カタカナ語中のハイフン類誤記（OCR 等による `サントリ-` / `ホ-ルディングス`）を長音符 `ー` に補正する。
 * `ン` (\u30F3) や `ッ` (\u30C3) の直後は `セブン-イレブン` 等の区切りハイフンであるため変換しない。
 */
function normalizeKatakanaChoonpu(text: string): string {
  return text.replace(
    /([\u30A1-\u30C2\u30C4-\u30F2\u30F4-\u30FA])[-‐‑–—―－](?=[\u30A1-\u30FA\u30FC]|$|[\s(])/gu,
    '$1ー',
  );
}

/**
 * 文字列を正規化して法人名候補リストを生成
 *
 * @param raw 入力文字列 (名刺OCR や手入力の揺れを含む)
 * @returns 最大10件の正規化候補
 */
export function normalizeCompanyName(raw: string): NormalizerResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      original: raw,
      extracted_core_name: '',
      normalized_candidates: [],
      fallback_note: 'Empty input',
    };
  }

  const appliedRules: string[] = [];

  // Rule 7: 空白類の揃え (NFKC で全角→半角 の前段、連続空白の除去)
  let work = trimmed.replace(/[\t\u3000]+/g, ' ').replace(/ {2,}/g, ' ');
  if (work !== trimmed) appliedRules.push('rule7_whitespace');

  // Rule 4: NFKC 正規化 (半角/全角英数字・㈱/㈲/㍿ 等の揃え)
  const beforeNfkc = work;
  work = work.normalize('NFKC');
  if (work !== beforeNfkc) appliedRules.push('rule4_nfkc');

  // NFKC 後に生じた連続空白の再圧縮
  work = work.replace(/ {2,}/g, ' ').trim();

  // Rule 6: 異体字セレクタ除去 (BMP Variation Selectors + Supplementary IVS)
  const beforeVs = work;
  work = work.replace(/[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu, '');
  if (work !== beforeVs) appliedRules.push('rule6_ivs_removed');

  // Rule 8: カタカナ長音符のハイフン誤記補正
  const beforeChoonpu = work;
  work = normalizeKatakanaChoonpu(work);
  if (work !== beforeChoonpu) appliedRules.push('rule8_choonpu_normalized');

  // Rule 1/2: 法人種別検出 + 前付け/後付け判定 (最長一致・端アンカー優先)
  // 「株式會社」「醫療法人」「學校法人」のように法人種別自体が旧字体の場合は新字体変換後で再検出する
  const newWork = applyOldToNew(work);
  const directKindDetection = detectKind(work);
  const kindOnNewOnly = directKindDetection.hint === null && newWork !== work;
  const kindDetection = kindOnNewOnly ? detectKind(newWork) : directKindDetection;
  const workForKind = kindOnNewOnly ? newWork : work;

  // Rule 3: 英語法人名検出
  const enDetection = detectEnglishKind(work);

  // ターゲット推定
  const suggestedTarget: '1' | '2' | '3' =
    kindDetection.hint === null && enDetection.hint !== null ? '3' : '1';

  // コア名 (法人種別を取り除いた部分)
  const rawCoreName = stripKindFromName(workForKind, kindDetection);
  const newCoreName = applyOldToNew(rawCoreName);
  const hasOldKanjiInCore = newCoreName !== rawCoreName || kindOnNewOnly;

  // 法人種別の略称展開を含めた正式商号 (旧字保持版 & 新字変換版)
  const canonicalOldFull = kindOnNewOnly ? work : buildFullName(rawCoreName, kindDetection, work);
  const canonicalNewFull = applyOldToNew(buildFullName(newCoreName, kindDetection, newWork));
  const hasOldKanjiOverall = canonicalNewFull !== canonicalOldFull || hasOldKanjiInCore;
  if (hasOldKanjiOverall) {
    appliedRules.push('rule5_old_to_new_char');
  }

  const abbrevExpanded =
    kindDetection.entry !== null && kindDetection.entry.word !== kindDetection.entry.canonical;
  const baseRules = abbrevExpanded ? [...appliedRules, 'rule1_abbrev_expanded'] : [...appliedRules];

  // normalize-company-name.ts が `other_registered` を「その他の設立登記法人」ラベルに置換して
  // 商号を破壊しないよう、1:1 対応の種別のみ mae_kabu/ato_kabu を公開する
  const publicPosition: PrefixOrSuffix = kindDetection.entry?.exactHintLabel
    ? kindDetection.rawPosition
    : 'none';

  const effectiveHint: KindHint = kindDetection.hint ?? enDetection.hint ?? 'unknown';

  // 候補生成
  const candidates: NormalizedCandidate[] = [];

  // a1. 正式法人格展開 + 新字体変換済みフルネーム（最優先候補）
  candidates.push({
    name: canonicalNewFull,
    kind_hint: effectiveHint,
    prefix_or_suffix: publicPosition,
    suggested_target: suggestedTarget,
    confidence: 0.95,
    applied_rules: hasOldKanjiOverall ? [...baseRules, 'rule5_old_to_new_applied'] : [...baseRules],
  });

  // a2. 旧字体が含まれていた場合、旧字体を保持した正式フルネームも併存（例: 野村證券株式会社）
  if (canonicalOldFull !== canonicalNewFull) {
    candidates.push({
      name: canonicalOldFull,
      kind_hint: effectiveHint,
      prefix_or_suffix: publicPosition,
      suggested_target: suggestedTarget,
      confidence: 0.92,
      applied_rules: baseRules.filter((r) => r !== 'rule5_old_to_new_char'),
    });
  }

  // b1. 法人種別を除去したコア名（新字体版）
  if (newCoreName.length > 0 && newCoreName !== canonicalNewFull) {
    candidates.push({
      name: newCoreName,
      kind_hint: kindDetection.hint ?? 'unknown',
      prefix_or_suffix: 'none',
      suggested_target: suggestedTarget,
      confidence: 0.9,
      applied_rules: [...baseRules, 'rule2_kind_separated'],
    });
  }

  // b2. 法人種別を除去したコア名（旧字体保持版）
  if (hasOldKanjiInCore && rawCoreName.length > 0) {
    candidates.push({
      name: rawCoreName,
      kind_hint: kindDetection.hint ?? 'unknown',
      prefix_or_suffix: 'none',
      suggested_target: suggestedTarget,
      confidence: 0.85,
      applied_rules: [
        ...baseRules.filter((r) => r !== 'rule5_old_to_new_char'),
        'rule2_kind_separated',
      ],
    });
  }

  // c. 前付け ↔ 後付け の反転候補 (株式会社・有限会社・合同会社・合資会社・合名会社・相互会社)
  if (kindDetection.entry?.invertible && newCoreName.length > 0) {
    const canonicalKind = kindDetection.entry.canonical;
    if (kindDetection.rawPosition === 'mae_kabu') {
      const invertedPosition: PrefixOrSuffix = kindDetection.entry.exactHintLabel
        ? 'ato_kabu'
        : 'none';
      candidates.push({
        name: `${newCoreName}${canonicalKind}`,
        kind_hint: kindDetection.entry.hint,
        prefix_or_suffix: invertedPosition,
        suggested_target: suggestedTarget,
        confidence: 0.75,
        applied_rules: [...baseRules, 'rule1_kabu_position_inverted'],
      });
      if (hasOldKanjiInCore) {
        candidates.push({
          name: `${rawCoreName}${canonicalKind}`,
          kind_hint: kindDetection.entry.hint,
          prefix_or_suffix: invertedPosition,
          suggested_target: suggestedTarget,
          confidence: 0.72,
          applied_rules: [
            ...baseRules.filter((r) => r !== 'rule5_old_to_new_char'),
            'rule1_kabu_position_inverted',
          ],
        });
      }
    } else if (kindDetection.rawPosition === 'ato_kabu') {
      const invertedPosition: PrefixOrSuffix = kindDetection.entry.exactHintLabel
        ? 'mae_kabu'
        : 'none';
      candidates.push({
        name: `${canonicalKind}${newCoreName}`,
        kind_hint: kindDetection.entry.hint,
        prefix_or_suffix: invertedPosition,
        suggested_target: suggestedTarget,
        confidence: 0.75,
        applied_rules: [...baseRules, 'rule1_kabu_position_inverted'],
      });
      if (hasOldKanjiInCore) {
        candidates.push({
          name: `${canonicalKind}${rawCoreName}`,
          kind_hint: kindDetection.entry.hint,
          prefix_or_suffix: invertedPosition,
          suggested_target: suggestedTarget,
          confidence: 0.72,
          applied_rules: [
            ...baseRules.filter((r) => r !== 'rule5_old_to_new_char'),
            'rule1_kabu_position_inverted',
          ],
        });
      }
    }
  }

  // d. 英語法人名が検出された場合、英語表記での検索候補
  if (enDetection.hint !== null && enDetection.stripped.length > 0) {
    candidates.push({
      name: enDetection.stripped,
      kind_hint: enDetection.hint,
      prefix_or_suffix: 'none',
      suggested_target: '3',
      confidence: 0.7,
      applied_rules: [...baseRules, 'rule3_english_detected'],
    });
  }

  // e. 中点 (・) を含む場合、ホスト版 DB 検索向けに中点除去コア名候補も追加
  if (newCoreName.includes('・')) {
    const dotless = newCoreName.replace(/・+/g, '');
    if (dotless.length > 0) {
      candidates.push({
        name: dotless,
        kind_hint: kindDetection.hint ?? 'unknown',
        prefix_or_suffix: 'none',
        suggested_target: '1',
        confidence: 0.68,
        applied_rules: [...baseRules, 'rule8_middle_dot_stripped'],
      });
    }
  }

  // 重複除去 + 10件上限
  const seen = new Set<string>();
  const uniqueCandidates = candidates
    .filter((c) => {
      if (c.name.length === 0 || seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    })
    .slice(0, 10);

  // コア名（新字体変換済み。英語サフィックスのみ検出された場合は英語コア名）
  const extractedCore =
    kindDetection.hint === null && enDetection.hint !== null && enDetection.stripped.length > 0
      ? applyOldToNew(enDetection.stripped)
      : newCoreName;

  return {
    original: raw,
    extracted_core_name: extractedCore,
    normalized_candidates: uniqueCandidates,
  };
}

interface KindDetection {
  hint: KindHint | null;
  rawPosition: PrefixOrSuffix;
  entry: KindKeywordEntry | null;
}

function detectKind(text: string): KindDetection {
  // 1. 先頭一致（前株・前付け法人格）を最長一致順で検査
  for (const entry of KIND_KEYWORDS_JA) {
    if (text.startsWith(entry.word)) {
      return { hint: entry.hint, rawPosition: 'mae_kabu', entry };
    }
  }
  // 2. 末尾一致（後株・後付け法人格）を最長一致順で検査
  for (const entry of KIND_KEYWORDS_JA) {
    if (text.endsWith(entry.word)) {
      return { hint: entry.hint, rawPosition: 'ato_kabu', entry };
    }
  }
  // 3. 中間出現（例: 支店名付き等）のフォールバック
  for (const entry of KIND_KEYWORDS_JA) {
    if (text.includes(entry.word)) {
      return { hint: entry.hint, rawPosition: 'none', entry };
    }
  }
  return { hint: null, rawPosition: 'none', entry: null };
}

function stripKindFromName(text: string, detection: KindDetection): string {
  if (detection.entry === null) return text;
  const word = detection.entry.word;
  if (detection.rawPosition === 'mae_kabu') {
    return text.slice(word.length).trim();
  }
  if (detection.rawPosition === 'ato_kabu') {
    return text.slice(0, text.length - word.length).trim();
  }
  return text.replace(word, ' ').replace(/ {2,}/g, ' ').trim();
}

function buildFullName(coreName: string, detection: KindDetection, fallbackWork: string): string {
  if (detection.entry === null) return fallbackWork;
  const canonical = detection.entry.canonical;
  if (coreName.length === 0) return canonical;
  if (detection.rawPosition === 'mae_kabu') {
    return `${canonical}${coreName}`;
  }
  if (detection.rawPosition === 'ato_kabu') {
    return `${coreName}${canonical}`;
  }
  return fallbackWork.replace(detection.entry.word, canonical);
}

interface EnglishDetection {
  hint: KindHint | null;
  stripped: string;
  matchedSuffix: string | null;
}

function detectEnglishKind(text: string): EnglishDetection {
  for (const { regex, hint } of EN_SUFFIX_PATTERNS) {
    const freshRegex = new RegExp(regex.source, regex.flags);
    const match = freshRegex.exec(text);
    if (match !== null) {
      const stripped = text
        .replace(freshRegex, '')
        .replace(/\s+,?\s*$/, '')
        .replace(/^,\s*/, '')
        .trim();
      return { hint, stripped, matchedSuffix: match[0] };
    }
  }
  return { hint: null, stripped: text, matchedSuffix: null };
}

export const OLD_TO_NEW_KANJI: Readonly<Record<string, string>> = OLD_TO_NEW;

export function applyOldToNew(text: string): string {
  let result = text;
  for (const [oldChar, newChar] of Object.entries(OLD_TO_NEW)) {
    if (result.includes(oldChar)) {
      result = result.split(oldChar).join(newChar);
    }
  }
  return result;
}

/**
 * ひらがな (U+3041..U+3096) をカタカナ (U+30A1..U+30F6) に変換する
 */
export function hiraganaToKatakana(text: string): string {
  return text.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

export interface CorporateKindDetails {
  core: string;
  hadKind: boolean;
  canonicalKind: string | null;
  position: PrefixOrSuffix;
  invertible: boolean;
}

/**
 * 先頭・末尾の法人格（略称・全角記号・旧字体を含む）を最長一致で検出し、
 * コア商号・正式法人格・前後位置・前後反転可否を返す
 */
export function extractCorporateKindDetails(raw: string): CorporateKindDetails {
  const cleaned = normalizeKatakanaChoonpu(
    raw
      .trim()
      .replace(/[\t\u3000]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .normalize('NFKC')
      .replace(/[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu, '')
      .replace(/ {2,}/g, ' ')
      .trim(),
  );
  if (cleaned.length === 0) {
    return {
      core: '',
      hadKind: false,
      canonicalKind: null,
      position: 'none',
      invertible: false,
    };
  }
  const direct = detectKind(cleaned);
  if (direct.entry !== null && direct.rawPosition !== 'none') {
    return {
      core: stripKindFromName(cleaned, direct),
      hadKind: true,
      canonicalKind: direct.entry.canonical,
      position: direct.rawPosition,
      invertible: Boolean(direct.entry.invertible),
    };
  }
  const newForm = applyOldToNew(cleaned);
  if (newForm !== cleaned) {
    const onNew = detectKind(newForm);
    if (onNew.entry !== null && onNew.rawPosition !== 'none') {
      return {
        core: stripKindFromName(newForm, onNew),
        hadKind: true,
        canonicalKind: onNew.entry.canonical,
        position: onNew.rawPosition,
        invertible: Boolean(onNew.entry.invertible),
      };
    }
  }
  return {
    core: raw.trim(),
    hadKind: false,
    canonicalKind: null,
    position: 'none',
    invertible: false,
  };
}

/**
 * 先頭・末尾の法人格（略称・旧字体を含む）を最長一致で除去し、コア商号と法人格有無を返す
 */
export function stripCorporateKind(raw: string): { core: string; hadKind: boolean } {
  const { core, hadKind } = extractCorporateKindDetails(raw);
  return { core, hadKind };
}
