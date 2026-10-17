# ADR 0012: v0.3.0 適格請求書発行事業者公表システム Web-API 統合

Date: 2026-04-29

## Status

Accepted

## Context

国税庁は 2 種類の Web-API を提供:

1. **法人番号 Web-API** (Ver.4.0) — v0.1.0 で実装済み
2. **適格請求書発行事業者公表システム Web-API** (Ver.1.0) — v0.3.0 で統合予定

両 API は同じアプリケーション ID で利用可能 (第一編 別添1 第2条第5号) だが、エンドポイント・応答形式・スキーマがすべて異なる。

国税庁から 2026-04-20 に届いたメール (5月7日期限) で、Excel 発行申請書の提出を求められており、v0.3.0 の準備が今動くべきタイミングに加速した。

## Decision

**v0.3.0 (2026-07 予定) で、適格請求書発行事業者 Web-API を別ドメインの `src/invoice/` 層として追加する。既存の法人番号 API 層 (`src/api/`) と完全に分離する。**

### ディレクトリ構造 (v0.3.0)

```
src/
├── api/                       # 法人番号 API (既存)
│   ├── nta-client.ts
│   ├── csv-parser.ts
│   └── rate-limiter.ts
├── invoice/                   # 適格請求書発行事業者 API (v0.3.0 新規)
│   ├── invoice-client.ts      # エンドポイント: /1/num, /1/diff, /1/valid
│   ├── csv-parser.ts          # 30 フィールドの新 schema
│   ├── json-parser.ts         # type=21 JSON 応答のパース
│   └── rate-limiter.ts        # 別 token bucket (500 件分割基準)
├── domain/
│   ├── corporate-number.ts    # 既存
│   ├── invoice-number.ts      # v0.3.0: T+13桁 Branded type (本 ADR で前倒し実装)
│   ├── invoice-codes.ts       # v0.3.0: process/kind/country コード辞書
│   └── ...
└── tools/
    ├── lookup-corporate-by-number.ts      # 既存
    ├── lookup-invoice-issuer.ts           # v0.3.0
    ├── verify-invoice-issuer-active.ts    # v0.3.0
    └── lookup-invoice-issuer-at-date.ts   # v0.3.0 (`/valid` エンドポイント活用)
```

### API 仕様差異の重要ポイント (第二編 1.5版 で再確認済み)

| 項目 | 法人番号 API (Ver.4.0) | インボイス API (Ver.1.0) |
|---|---|---|
| ベース URL | `api.houjin-bangou.nta.go.jp/4/` | `web-api.invoice-kohyo.nta.go.jp/1/` |
| エンドポイント1 | `/num` 法人番号指定 | `/num` 登録番号指定 |
| エンドポイント2 | `/diff` 取得期間指定 | `/diff` 取得期間指定 |
| エンドポイント3 | `/name` 法人名指定 | **`/valid` 登録番号+日付指定** (基準日時点の状態照会) |
| 応答形式 type | `01` CSV(SJIS) / `02` CSV(UTF8) / `12` XML | `01` CSV / `11` XML / **`21` JSON** |
| 文字コード | Shift-JIS or UTF-8 選択可 | 常に UTF-8 |
| 分割閾値 | 2,000 件 | **500 件** |
| 分割番号上限 | 1-99999 | **1-999999** |
| 番号形式 | 13桁 (半角数字) | **"T"+13桁 (計14桁、先頭はリテラル "T")** |
| 履歴情報 | `history=0/1` (所在地・商号の変更履歴) | `history=0/1` (**登録・取消・失効の履歴のみ**、氏名や所在地は常に最新) |
| 定義ファイル | リソース定義書 4.1版 | **リソース定義書 1.5版** (項目構造が異なる) |
| 利用規約 | 法人番号 Web-API 利用規約 | **適格請求書 Web-API 利用規約** (別添1、第11条の2 / 第11条の3 が追加) |
| 出典文言 (別添1 第6条) | 「国税庁法人番号システム Web-API 機能を利用して取得」 | **「適格請求書発行事業者公表システム Web-API 機能を利用して取得」** |

### 共通化できる部分

- **チェックデジット計算**: T を除いた 13 桁部分は法人番号と同じ計算式 (別紙1 項番8 の定義が同一)
- **レート制限 / バックオフ**: `TokenBucket` クラスを再利用
- **Server Card**: 両 API の capabilities を単一 `/.well-known/mcp.json` に統合
- **Attribution**: 各ツールで異なる `data_source` / `service_disclaimer` を返す必要あり、`buildAttribution()` を拡張

### 新しい Tool (v0.3.0)

1. **`lookup_invoice_issuer`** — T番号 (最大10件) で適格請求書発行事業者情報を取得
   - NTA `/1/num?id=...&number=T...&type=21&history=0|1`
2. **`verify_invoice_issuer_active`** — 登録・取消・失効の現在状態判定
   - NTA `/1/valid?id=...&number=T...&day=YYYY-MM-DD&type=21`
3. **`lookup_invoice_issuer_at_date`** — 基準日時点の登録状況
   - 同上、`day` を過去日付で指定
4. **`normalize_invoice_number`** — T番号の正規化 (文字列から T+13桁 抽出、チェックデジット検証)
5. **`get_invoice_attribution`** — 適格請求書 Web-API 機能 別添1 第6条 の指定文言を返却

### 新しい Prompt (v0.3.0)

1. **`invoice-issuer-verify-bulk`** — 請求書リスト一括検証ワークフロー (受領 T 番号が有効か一括確認)
2. **`invoice-transition-track`** — 免税→課税切替のタイミング追跡

## Consequences

### Positive

- **単一ID で両API 利用可**: Excel 申請書で `4. 法人番号のみ希望=はい` を選択することで、インボイス API 審査が通らなくても法人番号 API は確実に利用可能
- **B2B KYC の決定版になる**: 法人番号 + T番号の両方が引けるので、請求書処理 / 与信管理 / KYC 用途で現状唯一の MCP サーバ
- **v0.3.0 の実務価値**: インボイス対応は 2026 年時点で依然として B2B 経理・KYC の実務課題であり、露出ではなく利用価値として強い
- **同じ Application ID 管理で運用コスト増なし**: 1 RPS の token bucket を両 API で独立管理

### Negative

- 実装量が v0.1.0 と同程度増える (5-7h/週、2-3 週)
- 応答形式 (CSV/XML/JSON) の三択対応が必要 (v0.1.0 は CSV UTF-8 固定)
- 分割閾値が違う (500 vs 2000)、別 `divide` パラメータ管理が必要
- 別添1 第11条の2 (適格請求書発行事業者からの苦情処理) の体制構築が必要

### Neutral

- Excel 申請書は両方同時申請でも受理される (第一編 §5.2)

## 実装ロードマップ (v0.3.0 Sprint)

| Week | Task |
|---|---|
| W1 | ADR 0012 確定、`src/domain/invoice-number.ts` + `invoice-codes.ts` 先行実装 |
| W2 | `src/invoice/invoice-client.ts` + JSON/CSV/XML parser + fixture tests |
| W3 | 5 新 Tool 実装 (`lookup_invoice_issuer` 等) + Zod strict schema + attribution |
| W4 | 2 新 Prompt + Completion 拡張 + README 刷新 (ja/en) + Zenn 記事 |
| W5 | 6-host verification + v0.3.0 tag + npm publish |

## v0.1.0 での前倒し実装

本 ADR を確定させるにあたり、以下を v0.1.0 の時点で「準備層」として実装する (ZERO-PLACEHOLDER 原則を守りつつ、将来の拡張パスを type-safe に予約):

- `src/domain/invoice-number.ts`: T+13桁 の Branded type + チェックデジット検証 (法人番号ロジックの再利用)
- `src/domain/invoice-codes.ts`: 事業者処理区分 (01/02/03/04/99) + 人格区分 (1/2) + 国内外区分 (1/2/3)
- `tests/unit/invoice-number.test.ts`: T番号フォーマット検証、法人番号との整合性

v0.1.0 の `src/tools/` には新ツールを追加しない (v0.3.0 の目玉として取っておく)。

## References

- 国税庁 第一編 1.5版 (令和7年2月): 利用手続・利用規約 別添1-3
- 国税庁 第二編 1.5版 (令和6年5月) 別紙1: リソース定義書 1.5版

> **v1.0.0 追記 (2026-10)**: v1.0.0（凍結仕様 v1.7）では、ホスト版における Web-API 第三者提供制限を回避するため、適格請求書発行事業者公表サイトの公開ダウンロードデータ（CSV、リソース定義書 1.5版 30列）を自社 PostgreSQL データベースに取り込み、単一ツール `lookup_invoice_issuer`（`number` + オプション `as_of`）として提供している。
