# Prompt Injection Defense

本ドキュメントは `@sugukuru/mcp-houjin-bangou` における **プロンプトインジェクション攻撃および関連する MCP 固有脅威** への防御設計を公開するものです。透明性を持って攻撃面と緩和策を明示することで、コミュニティからの検証と報告を歓迎します。

This document publishes the prompt injection and MCP threat defense design of `@sugukuru/mcp-houjin-bangou`. We transparently disclose our attack surface and mitigations to welcome security reviews from the community.

## 参考文献 / References

- Simon Willison, ["Model Context Protocol has prompt injection security problems"](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/), 2025-04-09
- Invariant Labs, "Tool Poisoning Attacks" / "WhatsApp MCP Exploited"
- Elena Cross, ["The 'S' in MCP Stands for Security"](https://elenacross7.medium.com/), 2025
- OWASP MCP Security Cheat Sheet, 2026
- MCP 公式仕様 (`2025-11-25`) Security and Trust & Safety section

## 攻撃面と緩和策

### 1. Rug Pull (Silent Redefinition)

**攻撃**: インストール後にツール定義が動的に書き換わり、後から意図しない挙動に変化する。

**本プロジェクトの緩和**:

- **Tool description は `src/tools/*.ts` 内の静的定数** で定義し、ランタイム書き換えを行わない。
- **`eslint.config.js` で `no-new-func`, `no-eval`, `no-implied-eval` を `error`** に設定。
- **`initialize` で `listChanged: false` を返却**（`tools`, `resources`, `prompts` すべて `listChanged: false`）し、起動後にプリミティブ定義を変更しない。
- **`tests/integration/mcp-contract-snapshot.test.ts`** により、`tools/list`・`prompts/list`・`resources/list` の完全一致スナップショットを CI でロック。
- **`/.well-known/mcp.json` に Server Card（現行 `version: "1.0.2"`）を公開**し、提供プリミティブと安全対策メタデータを明示。

### 2. Tool Shadowing (Cross-Server)

**攻撃**: 同一 MCP ホスト内で複数サーバーが動作しているとき、悪意ある別サーバーが信頼できるツールの挙動や誘導を上書きする。

**本プロジェクトの緩和**:

- **ステートレスな Streamable HTTP モード** で動作し、セッション横断の可変状態を持たない。
- **パッケージ・名前空間の明示**: `@sugukuru/mcp-houjin-bangou`（MCP Registry 名 `jp.co.sugu-kuru/mcp-houjin-bangou`）で提供元を明確化。
- **サンプリング非宣言**: 本サーバーからクライアント側 LLM や他サーバーへの `sampling/createMessage` 呼び出しは一切行わない。

### 3. Tool Poisoning & Parameter Smuggling

**攻撃**: ツール説明文に `<IMPORTANT>...` 等の隠し命令を埋め込む、または未定義の余剰引数（`__sidenote`, `context` 等）を通じて機密情報を外部送信させる。

**本プロジェクトの緩和**:

- **すべてのツール説明文は人間可読な事実説明のみ** で構成し、`<IMPORTANT>` や `<system>` 等のメタ命令タグを含めない。
- **CI での自動 grep 検査**: `.github/workflows/ci.yml` で `grep -RInE '<IMPORTANT>|<instruction|<system>|ignore previous|disregard' src/tools/` を実行し、検出時はビルドを失敗させる。
- **全 5 ツールの `inputSchema` に Zod `.strict()`（`"additionalProperties": false`）を適用**: スキーマ外のフリースロット引数をプロトコル層で拒否し、パラメータ密輸を構造的に遮断。
- **`NTA_APPLICATION_ID` / `DATABASE_URL` は環境変数のみから取得**: ツール引数からは一切受け取らない。

### 4. Response-Mediated Injection & XSS in MCP Apps UI

**攻撃**: 公表データ内の文字列に HTML タグやスクリプト片が含まれていた場合、UI レンダリング時の XSS や LLM の誤動作を誘発する。

**本プロジェクトの緩和**:

- **すべての出力を構造化 JSON（`structuredContent`）および定型テキスト要約としてシリアライズ**し、生の HTML をツール応答に含めない。
- **MCP Apps UI Resource（`ui://corporate-card/mcp-app.html`, `ui://search-results/mcp-app.html`）では `document.createElement` と `textContent` のみを使用し、`innerHTML` / `insertAdjacentHTML` を一切使用しない**（単体テスト `tests/unit/ui-v18.test.ts` でも静的検査）。
- **厳格な SHA-256 CSP と Air-Gapped Iframe 設定**: `scripts/compute-csp-hashes.ts` によりインラインスクリプト・スタイルの SHA-256 ハッシュのみを許可し、`connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`、および `_meta.ui.csp`（`resourceDomains: []`, `connectDomains: []`）を強制。
- **すべての照会結果に `data_as_of` と国税庁利用規約準拠の `attribution` 文字列を必須付与**し、情報の出所とデータ時点を検証可能にする。

### 5. Confused Deputy, Enumeration & Log Leakage

**攻撃**: Read-only ツールであっても、LLM を介した過剰リクエスト（DoS）や登録番号の連番総当たり照会、エラーメッセージ経由の内部情報漏洩を狙う。

**本プロジェクトの緩和**:

- **ローカル Web-API 版**: 1 RPS トークンバケット + 指数バックオフ（30s → 1m → 5m → 30m）により国税庁 Web-API への過剰送信を抑制。
- **ホスト版 HTTP 保護**: `Origin` ヘッダ許可リスト検証（不一致時は HTTP `403`）、接続元 IP 単位の固定ウィンドウ型レート制限（既定: 60秒あたり最大60リクエスト、超過時は HTTP `429` + `Retry-After`）、およびリクエストボディ上限 `64kb`（超過時は HTTP `413`）。
- **ホスト版 DB 3ロール最小権限分離**: MCP サーバープロセスは `SELECT` 権限のみを持つ `houjin_reader` ロールで接続し、DB 変更・DDL を構造的に不可能化。
- **単一番号照会・ページサイズ上限（`limit`: 1〜20件、既定10件）・クエリ拘束カーソル（`queryKey` + `data_as_of`）**: バルク抽出や別検索条件へのカーソル流用を拒否。
- **入力値の非ログ化と SQL バインド値秘匿**: 照会された法人番号・登録番号・検索語をアクセスログに記録せず、DB 例外時も `formatErrorWithCause()` により `\nparams:` や内部 SQL スキーマをクライアント応答・ログから除去。

## 設計原則 (Design Principles)

### Read-Only アノテーションの明示

すべてのツールに以下の MCP Tool Annotations を明示しています（公開実体を照会する 3 ツールは `openWorldHint: true`、ローカル純粋計算の 2 ツールは `openWorldHint: false`）：

```typescript
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
}
```

### スコープ境界と禁止用途の明文化

ツールの説明文およびサーバー初期化時の `instructions`（日英併記）において、以下をモデルに対して明示しています：

- `lookup_invoice_issuer` は利用者が明示した登録番号を1件ずつ確認する用途に限定し、番号範囲の連番探索や一覧作成には使用しないこと。
- 個人連絡先（PII）を入力しないこと。
- 税理士法第2条に配慮し、公表データの客観的事実のみを回答して仕入税額控除の可否等の税務判断を行わないこと。

## ホスト側への推奨 (Host-Side Recommendations)

本 MCP サーバーを利用するクライアント環境には以下を推奨します：

1. 初回接続時にツールの静的説明文・アノテーションを確認する。
2. 複数 MCP サーバー併用時はサーバー名（名前空間）を可視化する。
3. セルフホスト公開時は必ず TLS リバースプロキシ配下で `ALLOWED_ORIGINS` と適切な `TRUST_PROXY` ホップ数を設定する。

## コミュニティへ

セキュリティ上の問題を発見された場合は、`info@sugu-kuru.co.jp` または GitHub Private Security Advisory（[`SECURITY.md`](../../SECURITY.md)）までご連絡ください。

更新履歴:

- 2026-04-29: v0.1.0 初版
- 2026-10-19: v1.0.0（MCP Apps UI `textContent` 徹底、HTTP Origin/RateLimit、DB 3ロール分離を反映）
- 2026-11-21: v1.0.2+（全ツール `.strict()` 入力スキーマ、UI URI・レート制限・ページ上限・バインド値秘匿の記述を最新実装と同期）
