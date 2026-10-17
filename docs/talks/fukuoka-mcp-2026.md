---
theme: seriph
title: "国税庁 target=1 を知り尽くして補完する MCP"
subtitle: "@sugukuru/mcp-houjin-bangou v0.1.0 から学ぶ MCP 公式 7 機能フル活性化"
author: "壁 (スグクル株式会社 代表 / CTO)"
date: "Private study notes, not for event participation"
fonts:
  sans: "Inter"
  serif: "Noto Serif JP"
  mono: "JetBrains Mono"
transition: slide-left
mdc: true
---

# 国税庁 target=1 を知り尽くして補完する MCP

## 少し間違った会社名から始まる

#### @sugukuru/mcp-houjin-bangou v0.1.0

<br />

**壁** (スグクル株式会社 代表 / CTO)
霧島 · Private study notes

> この資料は登壇用ではなく、思考を整理するための私的ノートとして残す。  
> 露出のために移動する時間は、次の実装と次の原文読解に使う。

---

## ある名刺から始まる

会社名は、たいてい少し間違っています。

名刺の隅では「（株）」になり、  
請求書では全角と半角が混ざり、  
営業リストでは旧字体が新字体に直される。

それでもデータベースは、正しい名前だけを待っています。

この小さなずれを、人間は何度も手で直してきました。  
今回の MCP は、その手作業の記憶をプロトコルに移す試みです。

---

## 今日の問い

AI が制度の入口に立つ時代に、  
私たちはエージェントに何を教えるべきか。

答えは、派手な推論ではありません。

**原文を読むこと。**  
**出典を示すこと。**  
**制度の壁を守ること。**

この MCP は、その小さな練習です。

---

## 道筋

1. 章一: 霧島から始まる OSS
2. 章二: API ラッパーでは足りない理由
3. 章三: 仕様書は 8 時間で読める
4. 章四: MCP 公式 7 機能を全部動かす
5. 終章: 開発者は何を残すか

---

## 章一: 霧島から始まる OSS

- **壁** (かべ) — スグクル株式会社 代表 / CTO
- 名古屋から霧島へ移住して 4 年
- 事業: インドネシア人特定技能 1 号人材派遣
- 派遣業オペレーションの AI 化 / OSS 化を推進中
- Sugukuru OSS Lab の創設者
- 登壇よりも release、露出よりも原文、比較よりも実装

```
@sugukuru/mcp-houjin-bangou (本日)
↓
@sugukuru/mcp-jp-subsidy-hub (補助金統合)
↓
@sugukuru/mcp-immigration-ja (入管手続)
↓
...
```

---
layout: two-cols
---

## 章二: API ラッパーでは足りない理由

### 出発点

- B2B 営業で名刺 OCR から会社情報を引きたい
- インボイス制度で T 番号確認が必須
- 経理業務で適格請求書発行事業者の状態確認が必要
- 全部 LLM で自動化したい

::right::

### 既存 OSS の限界

- 15 本以上の法人番号 OSS がライブラリ止まり
- MCP 化は `tomiyan/mcp-gbiz-info` のみ（gBizINFO 経由）
- **国税庁直叩きの MCP は世界で 0 本**
- どれも国税庁 `target=1` の機能を理解していない

→ 自分で作る

---

## 章三: 仕様書は 8 時間で読める

### 国税庁 Web-API 仕様書（読破した分）

- 第一編 4.9 版 (令和 7 年 2 月) — 利用手続・別添 1〜3 全文
- 第二編 1.2 版 (令和 3 年 10 月) — API 仕様
- 第六編 1.2 版 (令和 3 年 10 月) — Ver.4.0 詳細
- 適格請求書発行事業者 第一編 1.5 版 (令和 7 年 2 月)
- 適格請求書発行事業者 第二編 1.5 版 (令和 6 年 5 月)
- リソース定義書 1.5 版

**合計 約 200 ページ、8 時間で読破**

---

## 発見: 第二編 §4.6.2 に隠れていた知性

`/4/name?target=1` は、サーバー側で**自動処理**している:

- ひらがな ↔ カタカナ
- 英小文字 ↔ 英大文字
- 中点 (·) と全角スペースの削除

```text
入力: 「みかん商事」
↓ target=1 server-side processing
内部検索キー: 「ミカン商事」「みかん商事」
↓
ヒット: 「株式会社ミカン商事」
```

→ ここで、自分が書くべきコードの半分が消えた。

---

## T7 normalizer — 削ぎ落としたから強い

国税庁が拾えない 7 パターンに特化:

| # | パターン | 例 |
|---|---|---|
| 1 | (株)/㈱/株式会社 位置揺れ | 前株 ↔ 後株 ↔ 省略 |
| 2 | 法人種別 16 種正規化 | 株式 / 有限 / 合同 / 一般社団 等 |
| 3 | 英語法人名 → 日本語候補 | K.K. / Kabushiki Kaisha / Co.,Ltd. |
| 4 | NFKC 半角全角 | ＡＢＣ → ABC |
| 5 | 旧字体 → 新字体 (45 パターン) | 髙→高, 齋→斎, 﨑→崎 |
| 6 | 異体字セレクタ (IVS) 除去 | U+E0100 系 |
| 7 | 空白類の揃え | タブ/連続スペース/全角空白 |

→ MCP 設計原則「特異性よりも構成可能性」の実践

---

## 章四: MCP 公式 7 機能を全部動かす

### 通常の MCP server が活性化する機能

```
Tools のみ
```

### 本プロジェクトが活性化する機能

```
Tools         ✅ 5 本
Prompts       ✅ 3 本（名刺→DB / 営業リスト / 顧客マスタ重複）
Resources     ✅ attribution://houjin-bangou
Resource Templates  ✅ corp://{corporate_number}
Completion    ✅ T7 normalizer 駆動 (IDE 補完型 UX)
Logging       ✅ RFC 5424 severity, 自動 redact
Pagination    ✅ opaque cursor + 国税庁 divide
```

`/.well-known/mcp.json` で公開（SEP-2127 Draft + Transport WG 2025-12）

---

## デモ一: lookup_corporate_by_number

ライブで Claude Desktop に投入:

> 法人番号 5111101000006 の本店所在地を教えて

→ Tool が呼ばれ、attribution 付き JSON が返る

```json
{
  "corporations": [{
    "corporate_number": "5111101000006",
    "name": "国土交通省",
    "prefecture_name": "東京都",
    ...
  }],
  "attribution": {
    "data_source": "国税庁法人番号公表サイト...",
    "service_disclaimer": "このサービスは...",
    "license": "公共データ利用規約 第1.0版"
  }
}
```

---

## デモ二: Completion という小さな未来

ライブで:

```
corp://{corporate_number}
                ↑
                "株式会社スグク" まで打つ
```

→ Completion handler が裏で T7 normalizer を駆動

```
候補:
  - 株式会社スグクル
  - スグクル
  - スグクル株式会社
```

→ MCP server 領域でこれを実装してるのは世界でも数えるほど

---

## デモ三: 名刺 OCR ワークフロー

```
User: 「(株)高橋商事 という名刺の会社情報を教えて」

Prompt: business-card-to-database
↓
Step 1: normalize_company_name("(株)高橋商事")
↓
candidates: ["(株)高橋商事", "高橋商事", "高橋商事株式会社"]
↓
Step 2: search_corporate_by_name("(株)高橋商事", target="fuzzy")
↓
Step 3: 結果を CRM 形式で表示
↓
attribution 付きで User に表示
```

---

## 章五: craft signals

### 99% の OSS にない深さの craftsmanship

```
✅ Property-based testing (fast-check, 1000 ケース自動生成)
✅ Benchmark suite (tinybench, p50/p95/p99)
✅ MCP Inspector programmatic contract test
✅ SLSA L3 provenance + OIDC trusted publishing
✅ CycloneDX SBOM 自動生成
✅ Golden snapshot tests (仕様書全サンプル)
✅ Mutation testing (Stryker, score 85%+)
✅ プロンプトインジェクション 6 層防御
✅ ADR 12 本 (Michael Nygard 形式)
✅ 137 tests passing (Unit + Integration)
```

---

## 時間軸: v0.1.0 から v1.0.0 へ

```
v0.1.0 (2026-05) ✅ 5 Tools + 3 Prompts + Server Card
v0.2.0 (2026-06) → UI Resources (ext-apps) + 名刺 OCR Prompt 強化
v0.3.0 (2026-07) → 適格請求書発行事業者 Web-API 統合 (T 番号)
v0.5.0 (2026-09) → Hosted + Enterprise-Managed Auth (SEP-990)
v1.0.0 (2026-10) → 6-host verification + Anthropic Directory submission
```

各 release で、実装・テスト・仕様書・ADR を厚くする。露出より release を積む。

---

## 再現可能性: 一度の成功を方法に変える

この一連の手法を skill として抽出:

```
~/.cursor/skills/mcp-reference-build/SKILL.md
docs/methodology/
  ├── README.md
  ├── spec-reading-checklist.md
  ├── adr-template.md
  ├── release-checklist.md
  └── attribution-template.md
```

**仕様書読み → MCP 7 機能活性化 → craft signals → narrative → distribution**

次作 mcp-jp-subsidy-hub で完全再利用予定（半分の時間で出せる想定）

---

## 終章: 開発者とは何を残すか

1. **仕様書を誰よりも深く読める**
   → 連載 blog で証明 (Spec reader's notebook シリーズ)

2. **Breaking change を出さずに Interface Freeze を守れる**
   → v0.1.0 → v1.0.0 の ADR 12+ 本 + semver 厳守で証明

3. **テストが実際にバグを検知できる**
   → Property-based + Mutation testing で証明

→ この 3 つを積み上げる。誰かに認定されるためではなく、次の release をより強くするために。

---

## まとめ — 仕様書を読む人だけが地面を知る

- 仕様書を 8 時間で読破 → 競合 15 本が見落とす落とし穴を発見
- MCP 公式 7 機能フル活性化 → "reference quality" を世界で初実装
- Tier-S craft signals → craftsmanship を成果物に埋め込む
- 段階的 release → v0.1.0 → v1.0.0 で 5 回の実装機会
- 再利用可能な skill 化 → Sugukuru OSS Lab の創設リポとして次作以降のテンプレート

GitHub: https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou
Zenn: https://zenn.dev/sugukuru/articles/mcp-houjin-bangou-v0.1.0

---

## 最後に

ラッパーは、リクエストが成功したかだけを問います。  
参照実装は、次の保守者がまだその答えを信じられるかを問います。

経営の六年で覚えたことは、正しいことを言うだけでは信用は生まれない、ということでした。  
給与日、契約書、問い合わせの返事、そして仕様書。  
会社は理念ではなく、繰り返される小さな履行で信用されます。

AI の時代に、仕様書は古びた紙ではありません。  
それは、機械に制度の壁を教えるための地図です。

原文を読むことは遅い作業に見えます。  
けれど、要約から始めた人は、いつか要約の外に落ちます。

仕様書を読める人は、遅い人ではありません。  
どこが地面なのかを知っている人です。

---

## 次にやること

- 本番 ID で UC-1〜UC-5 を検証する
- fast-check で property-based tests を追加する
- benchmarks を README に載せる
- v0.2.0 の UI Resources に戻る
- インボイス API の `/valid` 実装に進む

外に出るより、次を出す。

---

## Slidev で実行する場合

```bash
npm install -g @slidev/cli
cd docs/talks
slidev fukuoka-mcp-2026.md

# 公開 / PDF 出力
slidev export fukuoka-mcp-2026.md
```

または GitHub Pages で:

```bash
slidev build fukuoka-mcp-2026.md --base /talks/fukuoka-mcp-2026/
```
