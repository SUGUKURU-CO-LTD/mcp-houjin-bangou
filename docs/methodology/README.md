# Methodology — @sugukuru/mcp-houjin-bangou の構築手法

本ディレクトリは、本プロジェクトを構築した手法・思想を**再現可能な形**で整理したものです。
将来の Sugukuru OSS Lab MCP サーバー（`mcp-jp-subsidy-hub`、`mcp-immigration-ja` 等）で
同じクオリティを担保するための社内手順書でもあります。

> [!NOTE]
> 本ディレクトリは v0.1.0 立上げ時の構築手法アーカイブです。現行のリポジトリ同梱スキルおよびエージェントルールは [`skills/lookup-japan-corporate/SKILL.md`](../../skills/lookup-japan-corporate/SKILL.md) および [`rules/AGENTS.md`](../../rules/AGENTS.md) を参照してください。

## 構成

| ファイル | 内容 |
|---|---|
| [spec-reading-checklist.md](spec-reading-checklist.md) | 対象 API 仕様書を読み込む際のチェックリスト（7 観点 + 落とし穴検出法） |
| [adr-template.md](adr-template.md) | Michael Nygard 形式の ADR テンプレート + 必須 12 本一覧 |
| [release-checklist.md](release-checklist.md) | v0.1.0 リリース前の 50 項目チェック |
| [attribution-template.md](attribution-template.md) | 利用規約遵守の出典文 Zod schema + 実装テンプレート |

## 時系列で辿る構築プロセス

### Week 0: 仕様書読み込み（48 時間の最初の投資）

1. 対象 API の全仕様書 PDF を入手（第一編〜最新編）
2. MCP 公式仕様 (2025-11-25 以降の最新) + 8 設計原則 + SEP
3. `spec-reading-checklist.md` の 7 観点で抽出
4. 落とし穴リスト作成（他の実装者が気付いていない点）
5. 既存実装の確認（比較のためではなく、重複実装を避けるため）

成果物: プロジェクト設計の根拠データ全部、`docs/adr/0001〜0003` の下書き

### Week 1: 設計 (Plan Mode)

1. Plan mode の 5 Part 構造（Design check / Batch 分割 / Interface Freeze / 検証計画 / リスク）
2. ADR 0001〜0012 を下書き
3. Zod schema 完全版（tool I/O + Attribution）
4. Directory 構造と依存方向ルール
5. Capability 宣言確定

成果物: Plan file, ADR 12 本下書き

### Week 2-3: 実装 (Agent Mode)

1. Domain 層（純粋関数 + property-based tests）
2. API 層（DI seam + fixture tests）
3. Tools / Prompts / Resources / Completion / Logging / Pagination
4. Server boot (Streamable HTTP stateless)
5. Server Card at `/.well-known/mcp.json`

成果物: `src/` + `tests/` 全部、137 tests passing

### Week 4: Release 準備

1. CI 5 本（ci / release / codeql / dependency-review / api-health-check）
2. SBOM + OIDC trusted publishing
3. Benchmark suite + README 表
4. README (英+日) + ADR 12 本 + policy + security
5. Zenn 記事下書き + Demo GIF

成果物: `v0.1.0-rc.X` タグ + `pnpm publish --dry-run` 成功

### Week 5: Distribution

1. README / ADR / API Reference の最終更新
2. Zenn 記事 1 本（原文読解と実装判断の記録）
3. release note
4. 次 release の branch / issue 起票
5. すぐ v0.2.0 実装へ戻る

成果物: npm 公開済み + 初動 reaction 計測

## 核となる 3 つの判断基準

どの実装判断でも、以下 3 問を自問する:

1. **対象 API 仕様書のどの節の、どの行で、この判断は根拠付けられるか？**
   → 答えられなければ、その判断は仕様書を読めていない証拠

2. **MCP 公式 8 設計原則のどれに、この判断は沿っているか？**
   → 原則と矛盾していたら、実装しない

3. **この判断を 2 年後に読み返して、当時の私に感謝するか？**
   → ADR に書いて将来の自分に根拠を残す

この 3 問を常に問えば、中級→上級への分水嶺を超える。

## 哲学

- **仕様書を読める人** は、自分の足元を他人の評価に預けない
- **Breaking change を出さずに Interface Freeze を守れる人** が信頼される開発者
- **テストが実際にバグを検知できる** こと（property-based + mutation）が craft の証明
- **ADR を書ける人** が判断できる人
- **デモを撮れる人** が「話せる人」と「書くだけの人」の分水嶺を超える

## 3 つの禁忌（やってはいけないこと）

1. **仕様書を読まずに実装着手する** — 後続で全てが歪む
2. **早期抽象化** — 3 本目が出るまで shared package を切り出さない
3. **一発で全部盛り込む** — v0.1.0 は 5 tools で十分、話題は段階的に作る
