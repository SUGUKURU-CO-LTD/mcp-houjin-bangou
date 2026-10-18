---
title: "国税庁あいまい検索 target=1 を知り尽くして補完する MCP ― mcp-houjin-bangou v0.1.0 リリース"
emoji: "🏢"
type: "tech"
topics: ["mcp", "claude", "typescript", "国税庁", "oss"]
published: false
---

# 国税庁あいまい検索 `target=1` を知り尽くして補完する MCP

> [!NOTE]
> 本文書は v0.1.0 リリース当時の記録・記事ドラフトです。現行の v1.0.0（Streamable HTTP トランスポート、リモートホスト版、最新のツール構成等）とは一部の記述や動作環境が異なります。現行仕様についてはルートの README を参照してください。

会社名は、たいてい少し間違っている。名刺の隅では「（株）」になり、請求書では全角と半角が混ざり、営業リストでは誰かが旧字体を新字体に直してしまう。それでもデータベースは、正しい名前だけを待っている。

この小さなずれを、人間は何度も手で直してきた。国税庁の検索窓を開き、思いつく表記をいくつか試し、候補の住所を見比べ、ようやく「これだ」と判断する。そこには派手な AI も、未来的な UI もない。ただ、事務の忍耐と、公的な事実にたどり着きたいという必要がある。

この MCP は、その手作業の記憶をプロトコルに移す試みです。

Sugukuru OSS Lab の最初のリリースとして、**国税庁 法人番号 Web-API (Ver.4.0) を Model Context Protocol サーバーで提供する `@sugukuru/mcp-houjin-bangou`** を v0.1.0 として公開しました。

Claude Desktop / Cursor / VS Code Copilot 等の MCP クライアントから、自然言語で 13 桁の法人番号検索・会社名検索・チェックデジット検証ができます。

```bash
NTA_APPLICATION_ID=your-id npx -y @sugukuru/mcp-houjin-bangou
```

ただの API ラッパーを出したいわけではありません。自分にとって問題だったのは、法人番号 API を呼べるかどうかではなく、**仕様書に既に書かれている知性を、どこまで尊重できるか** でした。

本プロジェクトは **MCP 公式 7 機能 (Tools / Resources / Resource Templates / Completion / Logging / Pagination / Server Card) を全部活性化**し、さらに**国税庁 API 自体の `target=1` あいまい検索の挙動を深く理解した上で、重複しない「補完層」を提供する**、というコンセプトで設計しました。

本記事ではその設計の勘所を書きます。

## 原文に残っていた設計の芯

npm や GitHub の一覧を見る前に、まず国税庁 Web-API 機能仕様書を読みました。第一編、第二編、第六編。さらに適格請求書発行事業者公表システムの第一編と第二編。要約ではなく原文を読むと、実装の輪郭が少しずつ決まっていきます。

国税庁 Web-API 機能仕様書 第二編 §4.6.2 を読むと、`target=1` (JIS 第一・第二水準) 指定時、国税庁が**サーバー側で**以下を自動処理していることが分かります:

- ひらがな → カタカナ置換 (`みかん` ↔ `ミカン`)
- 英小文字 → 英大文字置換 (`abc` ↔ `ABC`)
- 「・(中点)」や全角スペースの削除

ここで、自分が書くべきコードの半分が消えました。ひらがなをカタカナに直すことや、中点を削ることは、もう国税庁側がやっている。こちらがやるべきことは、そこを尊重し、国税庁が拾わない部分だけを補うことでした。

## T7 `normalize_company_name` — 国税庁が拾えない 7 パターンだけやる

本 MCP の差別化の核は T7 です。国税庁 API が**拾えない** 7 パターンに絞って補完します:

1. **`(株)` / `㈱` / `株式会社` / `（株）` の位置揺れ** — 前株 / 後株 / 省略 の 3 パターン展開
2. **法人種別の正規化・分離** — 株式 / 有限 / 合同 / 合名 / 合資 / 一般社団 / 特定非営利活動 等
3. **英語法人名 → 日本語候補** — `K.K.` / `Kabushiki Kaisha` / `Co.,Ltd.` / `Inc.` / `LLC` を検出し、`target=3` (英語表記) にルーティング
4. **半角 / 全角英数字の正規化** — Unicode NFKC
5. **旧字体 → 新字体** — `髙→高`、`齋→斎`、`﨑→崎` 等
6. **異体字セレクタ (IVS) 除去**
7. **空白類の揃え** — タブ・連続スペース・全角/半角

例えば名刺 OCR で `（株）高橋商事` が取れた場合:

```json
{
  "original": "（株）高橋商事",
  "extracted_core_name": "高橋商事",
  "normalized_candidates": [
    { "name": "(株)高橋商事", "kind_hint": "kabushiki_kaisha", "prefix_or_suffix": "mae_kabu", "confidence": 0.95 },
    { "name": "高橋商事", "kind_hint": "kabushiki_kaisha", "prefix_or_suffix": "none", "confidence": 0.9 },
    { "name": "高橋商事株式会社", "kind_hint": "kabushiki_kaisha", "prefix_or_suffix": "ato_kabu", "confidence": 0.75 }
  ],
  "recommendation": "次に search_corporate_by_name を呼び、name=\"(株)高橋商事\" と search_target=\"fuzzy\" を指定してください"
}
```

LLM はこれを confidence 降順で `search_corporate_by_name` に通せば、1 回で見つからなくても次候補に進める、というフローが成立します。

## 地味に効く: Completion capability で IDE 補完型 UX

MCP に `completion/complete` があるのをご存知でしょうか。Prompt 引数や Resource Template URI の引数に対して、サーバー側が候補を返す仕組みです。本 MCP は**この Completion の裏に T7 normalizer を繋ぎました**。

```
User types:  "株式会社スグク"
           ↓ completion/complete
Server:     ["株式会社スグクル", "スグクル", "スグクル株式会社"]
```

つまり Claude Desktop や MCP Inspector で `corp://{corporate_number}` の Resource Template を参照するとき、「会社名を途中まで入れたら候補が出る」 IDE 補完風の体験が成立します。私が調べた限り、国税庁 API 領域でこれをやっている OSS は他にありません。

## MCP 7 機能フル活性化

MCP 公式仕様には Tools だけでなく、Prompts、Resources、Resource Templates、Completion、Logging、Pagination が定義されています。本 MCP では、それらを単なる飾りではなく、実際の使い道がある形で宣言・実装しました。

```typescript
new McpServer({ name, version }, {
  capabilities: {
    tools: { listChanged: true },
    resources: { listChanged: true, subscribe: false },
    prompts: { listChanged: true },
    completions: {},
    logging: {}
  }
});
```

- **Tools** × 5 (lookup / search / validate / normalize / get_attribution)
- **Resources** — `attribution://houjin-bangou` (出典情報)
- **Resource Templates** — `corp://{corporate_number}` (法人番号で法人情報にアクセス)
- **Completion** — T7 を裏で駆動
- **Logging** — RFC 5424 severity の構造化ログを `notifications/message` で配信
- **Pagination** — 国税庁の `divideNumber`/`divideSize` を MCP opaque cursor に変換
- **Server Card** — `/.well-known/mcp.json` (SEP-2127 Draft + Transport WG Dec 2025 の先行実装)

## セキュリティ設計 — read-only を最大の武器に

2025 年 4 月に Simon Willison が [MCP has prompt injection security problems](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/) を公開し、Rug Pull / Tool Shadowing / Tool Poisoning 等の攻撃面が話題になりました。本 MCP は 6 層の防御を組み込みました:

1. **Tool description は静的定数** — ランタイム書換禁止、CI で `<IMPORTANT>` 等 grep 検知
2. **静的 tool description** — SDK v1 は `listChanged: true` を返すが、運用中に tool 定義を書き換えない
3. **Zod strict schema** (`additionalProperties: false`) — sidenote 型フリースロット不可
4. **Application ID は env のみ** — tool 引数経由で受け取らない
5. **全 tool output に `attribution` 必須化** — LLM が出典を user に伝えられる
6. **Read-only 明示** — `destructiveHint: false, readOnlyHint: true`

国税庁利用規約の第9条第1項五号 (ID譲渡禁止) に準拠するため、アプリケーション ID は環境変数のみ経由、ログ出力時は自動で `***REDACTED***` にマスクしています。

## 仕様書を引用可能なレベルで準拠

本プロジェクトの特徴として、**すべての設計決定に国税庁仕様書の節番号を書ける**ようにしました:

| 決定 | 引用元 |
|---|---|
| `type=02` (CSV UTF-8) 採用 | 第二編 §2.1.3 |
| チェックデジット計算 | 第二編 §2.1.3 + check_digit.pdf |
| `target=1` あいまい検索の挙動 | 第二編 §4.6.2 |
| 出典必須文言 | 別添1 第6条 |
| 3 年無利用停止 | 第一編 §5.3 + 別添1 第4条第5項 |
| 1 RPS レート制限の根拠 | 別添1 第9条第1項三号 |

ADR (Architecture Decision Records) 10 本を Michael Nygard 形式で `docs/adr/` に配置しています。

## 段階的ロードマップ

1 回のリリースで詰め込みすぎると継続的な話題が作れなくなります。Anthropic の [voluntas/yusukebe モデル](https://github.com/voluntas) を参考に、4 段階のリリースに分けました:

- **v0.1.0** (今回) — 5 Tool + MCP 7 機能 + Server Card
- **v0.2.0** — MCP **Prompts** (名刺→DB / 営業リスト enrichment / 顧客マスタ重複) + UI Resources
- **v0.3.0** — **適格請求書発行事業者 Web-API 統合 (T番号対応)** — 同じ ID で利用できるのが強み
- **v0.5.0** — Hosted + **Enterprise-Managed Authorization** (SEP-990) + **OAuth Client Credentials** + **Tasks** primitive (SEP-1699)
- **v1.0.0** — 6-host verification + Anthropic Directory submission + Skills 移行検討

特に v0.3.0 で**適格請求書発行事業者 API と統合**する予定です。T番号 (`T` + 13桁法人番号) の検証、登録年月日、失効情報まで取れるようになり、B2B 経理・KYC 領域で真価を発揮します。

## 使い方 — 5 行で始められる

Claude Desktop の `claude_desktop_config.json` に:

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "command": "npx",
      "args": ["-y", "@sugukuru/mcp-houjin-bangou"],
      "env": {
        "NTA_APPLICATION_ID": "あなたのID"
      }
    }
  }
}
```

Claude Desktop を再起動して試す:

> 「（株）高橋商事」という名刺に書かれた会社名から、正規化候補を作って国税庁で検索し、法人番号・本店住所を教えてください。

アプリケーション ID は https://www.invoice-kohyo.nta.go.jp/web-api/pre-reg/ から無料発行できます。同じ ID で適格請求書発行事業者 Web-API も使えるので、v0.3.0 でインボイス対応したときもセットアップし直す必要はありません。

## まとめ

このプロジェクトでやったことを短くまとめると、こうなります。

- **既存 OSS が重複実装していた正規化を、国税庁 API が既にやっていると気付いて削ぎ落とした**
- **代わりに国税庁が拾えない 7 パターンを `normalize_company_name` で補完**
- **MCP 公式 7 機能すべてを活性化**
- **Completion × T7 で IDE 補完型 UX を実現**
- **仕様書を根拠として引用可能なレベルで ADR 10 本に記録**
- **プロンプトインジェクション 6 層防御を透明に公開**

けれど、もう少し正確に言えば、これは「法人番号 API を MCP 化した話」ではありません。公的な事実を、AI エージェントの時代に耐えうるかたちへ移し替える、小さな練習です。経営の現場にいると、正しい情報が遅れて届くだけで、人の時間も、請求書も、信用も少しずつ傷みます。だからこそ、仕様書を読むことと、約束した形式で出力することは、単なる実装ではなく責任です。

ラッパーは、リクエストが成功したかだけを問います。参照実装は、次の保守者がまだその答えを信じられるかを問います。

鹿児島のインドネシア人特定技能派遣会社 (スグクル株式会社) がオープンソースで日本経済に貢献する、という挑戦の 1 本目です。次は `mcp-jp-subsidy-hub` (補助金統合 MCP)、`mcp-immigration-ja` (入管手続 MCP) を予定しています。

GitHub: https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou
npm: https://www.npmjs.com/package/@sugukuru/mcp-houjin-bangou

Issue や PR はもちろん開いています。ただ、このプロジェクトの中心は露出ではありません。次の仕様書を読み、次の schema を固め、次の release を出すことです。

原文を読むことは遅い作業に見えます。けれど、要約から始めた人は、いつか要約の外に落ちます。

仕様書を読める人は、遅い人ではありません。どこが地面なのかを知っている人です。

## Appendix: 本記事で触れられなかった MCP 仕様関連 Deep Dive

- 2026 MCP Roadmap の Top 4 ("Transport Evolution / Agent Communication / Governance / Enterprise Readiness") と本プロジェクトの整合性 → [docs/architecture.md](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/blob/main/docs/architecture.md)
- プロンプトインジェクション防御の 6 層詳細 → [docs/security/prompt-injection-defense.md](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/blob/main/docs/security/prompt-injection-defense.md)
- ADR (Architecture Decision Records) 0001-0010 → [docs/adr/](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/tree/main/docs/adr)

---

**出典**: 国税庁法人番号公表サイト（国税庁）https://www.houjin-bangou.nta.go.jp/

このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。
