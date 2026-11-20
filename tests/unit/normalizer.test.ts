/**
 * T7 normalizer テスト
 * 国税庁 target=1 補完 + ホスト版 DB 検索対応の網羅検証
 */

import { describe, it, expect } from 'vitest';
import { normalizeCompanyName } from '../../src/domain/normalizer.js';

describe('normalizeCompanyName - Rule 1: (株)/㈱/株式会社 略称展開と位置揺れ', () => {
  it('前株を検出する', () => {
    const r = normalizeCompanyName('株式会社スグクル');
    expect(r.extracted_core_name).toBe('スグクル');
    expect(r.normalized_candidates[0]?.name).toBe('株式会社スグクル');
    expect(r.normalized_candidates[0]?.kind_hint).toBe('kabushiki_kaisha');
    expect(r.normalized_candidates[0]?.prefix_or_suffix).toBe('mae_kabu');
  });

  it('後株を検出する', () => {
    const r = normalizeCompanyName('スグクル株式会社');
    expect(r.extracted_core_name).toBe('スグクル');
    expect(r.normalized_candidates[0]?.name).toBe('スグクル株式会社');
    expect(r.normalized_candidates[0]?.kind_hint).toBe('kabushiki_kaisha');
    expect(r.normalized_candidates[0]?.prefix_or_suffix).toBe('ato_kabu');
  });

  it('(株) を先頭候補で 株式会社 に正式展開する', () => {
    const r = normalizeCompanyName('(株)スグクル');
    expect(r.normalized_candidates[0]?.name).toBe('株式会社スグクル');
    expect(r.normalized_candidates[0]?.kind_hint).toBe('kabushiki_kaisha');
    expect(r.normalized_candidates[0]?.applied_rules).toContain('rule1_abbrev_expanded');
  });

  it('（株）全角カッコ版も 株式会社 に正式展開する', () => {
    const r = normalizeCompanyName('（株）スグクル');
    expect(r.normalized_candidates[0]?.name).toBe('株式会社スグクル');
    expect(r.normalized_candidates[0]?.kind_hint).toBe('kabushiki_kaisha');
  });

  it('㈱ 合字および ㍿ も 株式会社 に正式展開する', () => {
    const r1 = normalizeCompanyName('㈱スグクル');
    expect(r1.normalized_candidates[0]?.name).toBe('株式会社スグクル');
    expect(r1.normalized_candidates[0]?.kind_hint).toBe('kabushiki_kaisha');

    const r2 = normalizeCompanyName('スグクル㍿');
    expect(r2.normalized_candidates[0]?.name).toBe('スグクル株式会社');
    expect(r2.normalized_candidates[0]?.prefix_or_suffix).toBe('ato_kabu');
  });

  it('前株・後株の双方向反転候補を生成する（株式会社・有限会社・合同会社・合資会社・合名会社・相互会社）', () => {
    const kabu = normalizeCompanyName('株式会社スグクル');
    expect(
      kabu.normalized_candidates.find(
        (c) => c.prefix_or_suffix === 'ato_kabu' && c.name === 'スグクル株式会社',
      ),
    ).toBeDefined();

    const godo = normalizeCompanyName('(同)アマゾン');
    expect(godo.normalized_candidates[0]?.name).toBe('合同会社アマゾン');
    expect(godo.normalized_candidates.some((c) => c.name === 'アマゾン合同会社')).toBe(true);

    const yugen = normalizeCompanyName('テスト(有)');
    expect(yugen.normalized_candidates[0]?.name).toBe('テスト有限会社');
    expect(yugen.normalized_candidates.some((c) => c.name === '有限会社テスト')).toBe(true);

    const sougo = normalizeCompanyName('日本生命保険(相)');
    expect(sougo.normalized_candidates[0]?.name).toBe('日本生命保険相互会社');
    expect(sougo.normalized_candidates.some((c) => c.name === '相互会社日本生命保険')).toBe(true);
  });
});

describe('normalizeCompanyName - Rule 2: 法人種別の網羅的識別と最長一致', () => {
  it.each([
    ['有限会社テスト', '有限会社テスト', 'テスト', 'yugen_kaisha'],
    ['㈲テスト', '有限会社テスト', 'テスト', 'yugen_kaisha'],
    ['合同会社テスト', '合同会社テスト', 'テスト', 'godo_kaisha'],
    ['合名会社テスト', '合名会社テスト', 'テスト', 'gomei_kaisha'],
    ['(名)テスト', '合名会社テスト', 'テスト', 'gomei_kaisha'],
    ['合資会社テスト', '合資会社テスト', 'テスト', 'goshi_kaisha'],
    ['(資)テスト', '合資会社テスト', 'テスト', 'goshi_kaisha'],
    ['(一社)テスト協会', '一般社団法人テスト協会', 'テスト協会', 'ippan_shadan_hojin'],
    ['(公社)テスト協会', '公益社団法人テスト協会', 'テスト協会', 'koueki_shadan_hojin'],
    ['(一財)テスト財団', '一般財団法人テスト財団', 'テスト財団', 'ippan_zaidan_hojin'],
    ['(公財)テスト財団', '公益財団法人テスト財団', 'テスト財団', 'koueki_zaidan_hojin'],
    ['特定非営利活動法人テスト', '特定非営利活動法人テスト', 'テスト', 'npo_hojin'],
    ['NPO法人テスト', '特定非営利活動法人テスト', 'テスト', 'npo_hojin'],
    ['(特非)テスト', '特定非営利活動法人テスト', 'テスト', 'npo_hojin'],
    ['医療法人社団葵会', '医療法人社団葵会', '葵会', 'other_registered'],
    ['医療法人財団明理会', '医療法人財団明理会', '明理会', 'other_registered'],
    ['社会医療法人愛仁会', '社会医療法人愛仁会', '愛仁会', 'other_registered'],
    ['(医)徳洲会', '医療法人徳洲会', '徳洲会', 'other_registered'],
    ['(学)早稲田大学', '学校法人早稲田大学', '早稲田大学', 'other_registered'],
    ['(福)恩賜財団済生会', '社会福祉法人恩賜財団済生会', '恩賜財団済生会', 'other_registered'],
    ['(宗)明治神宮', '宗教法人明治神宮', '明治神宮', 'other_registered'],
    ['更生保護法人日本保護会', '更生保護法人日本保護会', '日本保護会', 'other_registered'],
    ['国立大学法人東京大学', '国立大学法人東京大学', '東京大学', 'other_registered'],
    ['公立大学法人大阪', '公立大学法人大阪', '大阪', 'other_registered'],
    [
      '地方独立行政法人東京都立病院機構',
      '地方独立行政法人東京都立病院機構',
      '東京都立病院機構',
      'other_registered',
    ],
    [
      '(独)情報処理推進機構',
      '独立行政法人情報処理推進機構',
      '情報処理推進機構',
      'other_registered',
    ],
    ['有限責任監査法人トーマツ', '有限責任監査法人トーマツ', 'トーマツ', 'other_registered'],
    ['監査法人アヴァンティア', '監査法人アヴァンティア', 'アヴァンティア', 'other_registered'],
    [
      '弁護士法人西村あさひ法律事務所',
      '弁護士法人西村あさひ法律事務所',
      '西村あさひ法律事務所',
      'other_registered',
    ],
    [
      '税理士法人山田&パートナーズ',
      '税理士法人山田&パートナーズ',
      '山田&パートナーズ',
      'other_registered',
    ],
    ['司法書士法人新宿事務所', '司法書士法人新宿事務所', '新宿事務所', 'other_registered'],
    [
      '行政書士法人第一綜合事務所',
      '行政書士法人第一綜合事務所',
      '第一綜合事務所',
      'other_registered',
    ],
    [
      '社会保険労務士法人大野事務所',
      '社会保険労務士法人大野事務所',
      '大野事務所',
      'other_registered',
    ],
    ['弁理士法人深見特許事務所', '弁理士法人深見特許事務所', '深見特許事務所', 'other_registered'],
    [
      '特許業務法人オンダ国際特許事務所',
      '特許業務法人オンダ国際特許事務所',
      'オンダ国際特許事務所',
      'other_registered',
    ],
    [
      '土地家屋調査士法人東京エス・アール',
      '土地家屋調査士法人東京エス・アール',
      '東京エス・アール',
      'other_registered',
    ],
    ['京都(信金)', '京都信用金庫', '京都', 'other_registered'],
    ['東京(信組)', '東京信用組合', '東京', 'other_registered'],
    ['中央労働金庫', '中央労働金庫', '中央', 'other_registered'],
    [
      '鹿児島きもつき農業協同組合',
      '鹿児島きもつき農業協同組合',
      '鹿児島きもつき',
      'other_registered',
    ],
    ['日本生活協同組合連合会', '日本生活協同組合連合会', '日本 連合会', 'other_registered'],
    ['東京事業協同組合', '東京事業協同組合', '東京', 'other_registered'],
    ['銀座商店街振興組合', '銀座商店街振興組合', '銀座', 'other_registered'],
    ['晴海フラッグ管理組合法人', '晴海フラッグ管理組合法人', '晴海フラッグ', 'other_registered'],
    [
      '日本ビルファンド投資法人',
      '日本ビルファンド投資法人',
      '日本ビルファンド',
      'other_registered',
    ],
  ])('%s -> 正規化名 %s, コア名 %s, hint %s', (input, expectedFull, expectedCore, expectedHint) => {
    const r = normalizeCompanyName(input);
    expect(r.normalized_candidates[0]?.name).toBe(expectedFull);
    expect(r.extracted_core_name).toBe(expectedCore);
    expect(r.normalized_candidates[0]?.kind_hint).toBe(expectedHint);
  });

  it('other_registered 種別では prefix_or_suffix を none とし、ツール側でラベル誤置換を防ぐ', () => {
    const r = normalizeCompanyName('医療法人社団葵会');
    expect(r.normalized_candidates[0]?.prefix_or_suffix).toBe('none');
    expect(r.normalized_candidates[0]?.name).toBe('医療法人社団葵会');
  });
});

describe('normalizeCompanyName - Rule 3: 英語法人名検出', () => {
  it('K.K. を認識', () => {
    const r = normalizeCompanyName('Sugukuru K.K.');
    const hasEnCandidate = r.normalized_candidates.some((c) => c.suggested_target === '3');
    expect(hasEnCandidate).toBe(true);
  });

  it('Kabushiki Kaisha を認識', () => {
    const r = normalizeCompanyName('Sugukuru Kabushiki Kaisha');
    const hasEnCandidate = r.normalized_candidates.some((c) => c.suggested_target === '3');
    expect(hasEnCandidate).toBe(true);
  });

  it('Co.,Ltd. を認識', () => {
    const r = normalizeCompanyName('Sugukuru Co., Ltd.');
    const hasEnCandidate = r.normalized_candidates.some((c) => c.suggested_target === '3');
    expect(hasEnCandidate).toBe(true);
  });

  it('Inc. / Corp. / LLC / G.K. を認識', () => {
    expect(
      normalizeCompanyName('Sugukuru Inc.').normalized_candidates.some(
        (c) => c.kind_hint === 'foreign_company' && c.suggested_target === '3',
      ),
    ).toBe(true);

    expect(
      normalizeCompanyName('Sugukuru Corp.').normalized_candidates.some(
        (c) => c.kind_hint === 'other_registered' && c.suggested_target === '3',
      ),
    ).toBe(true);

    expect(
      normalizeCompanyName('Sugukuru LLC').normalized_candidates.some(
        (c) => c.kind_hint === 'godo_kaisha',
      ),
    ).toBe(true);

    expect(
      normalizeCompanyName('Sugukuru G.K.').normalized_candidates.some(
        (c) => c.kind_hint === 'godo_kaisha',
      ),
    ).toBe(true);
  });
});

describe('normalizeCompanyName - Rule 4/5/6/7/8: NFKC・旧字新字・IVS・空白・長音符', () => {
  it('全角英数字を半角に正規化する (NFKC)', () => {
    const r = normalizeCompanyName('ＡＢＣ１２３株式会社');
    expect(r.normalized_candidates[0]?.name).toBe('ABC123株式会社');
    expect(r.normalized_candidates[0]?.applied_rules).toContain('rule4_nfkc');
  });

  it('略称 + 旧字体（（株）髙橋商事 / 野村證券株式会社 / 株式會社栁澤鐵工）で新字版と旧字保持版の両方を生成する', () => {
    const r1 = normalizeCompanyName('（株）髙橋商事');
    expect(r1.extracted_core_name).toBe('高橋商事');
    expect(r1.normalized_candidates[0]?.name).toBe('株式会社高橋商事');
    expect(r1.normalized_candidates.some((c) => c.name === '株式会社髙橋商事')).toBe(true);
    expect(r1.normalized_candidates.some((c) => c.name === '高橋商事')).toBe(true);
    expect(r1.normalized_candidates.some((c) => c.name === '高橋商事株式会社')).toBe(true);

    const r2 = normalizeCompanyName('野村證券株式会社');
    expect(r2.extracted_core_name).toBe('野村証券');
    expect(r2.normalized_candidates[0]?.name).toBe('野村証券株式会社');
    expect(r2.normalized_candidates.some((c) => c.name === '野村證券株式会社')).toBe(true);

    const r3 = normalizeCompanyName('株式會社栁澤鐵工');
    expect(r3.extracted_core_name).toBe('柳沢鉄工');
    expect(r3.normalized_candidates[0]?.name).toBe('株式会社柳沢鉄工');
  });

  it('異体字セレクタ (BMP VS / Supplementary IVS) を除去する (Rule 6)', () => {
    const r = normalizeCompanyName('葛\u{E0100}城\uFE00商事株式会社');
    expect(r.normalized_candidates[0]?.name).toBe('葛城商事株式会社');
    expect(r.normalized_candidates[0]?.applied_rules).toContain('rule6_ivs_removed');
  });

  it('タブ・連続スペース・全角スペースを正規化する (Rule 7)', () => {
    expect(
      normalizeCompanyName('株式会社\tスグクル').normalized_candidates[0]?.applied_rules,
    ).toContain('rule7_whitespace');
    expect(
      normalizeCompanyName('株式会社   スグクル').normalized_candidates[0]?.applied_rules,
    ).toContain('rule7_whitespace');
    expect(
      normalizeCompanyName('株式会社\u3000スグクル').normalized_candidates[0]?.applied_rules,
    ).toContain('rule7_whitespace');
  });

  it('カタカナ語中のハイフン誤記を長音符 (ー) に補正しつつ、ン直後の区切りハイフンは維持する (Rule 8)', () => {
    const r1 = normalizeCompanyName('サントリ-ホ-ルディングス(株)');
    expect(r1.normalized_candidates[0]?.name).toBe('サントリーホールディングス株式会社');
    expect(r1.extracted_core_name).toBe('サントリーホールディングス');
    expect(r1.normalized_candidates[0]?.applied_rules).toContain('rule8_choonpu_normalized');

    const r2 = normalizeCompanyName('株式会社セブン-イレブン・ジャパン');
    expect(r2.normalized_candidates[0]?.name).toBe('株式会社セブン-イレブン・ジャパン');
    expect(r2.normalized_candidates.some((c) => c.name === 'セブン-イレブンジャパン')).toBe(true);
  });
});

describe('normalizeCompanyName - 境界値', () => {
  it('空文字列および空白のみは候補なし', () => {
    const empty = normalizeCompanyName('');
    expect(empty.normalized_candidates.length).toBe(0);
    expect(empty.fallback_note).toBeDefined();

    const spaces = normalizeCompanyName('   ');
    expect(spaces.normalized_candidates.length).toBe(0);
  });

  it('候補は最大10件で重複なし', () => {
    const r = normalizeCompanyName('髙﨑齋齊濵德藪禮Test K.K.');
    expect(r.normalized_candidates.length).toBeLessThanOrEqual(10);
    const names = r.normalized_candidates.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('法人種別なしのコア名のみ', () => {
    const r = normalizeCompanyName('スグクル');
    expect(r.normalized_candidates[0]?.kind_hint).toBe('unknown');
    expect(r.extracted_core_name).toBe('スグクル');
  });
});
