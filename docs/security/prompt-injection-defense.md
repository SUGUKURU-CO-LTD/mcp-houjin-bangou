# Prompt Injection Defense

本ドキュメントは `@sugukuru/mcp-houjin-bangou` における **プロンプトインジェクション攻撃** への防御設計を公開するものです。透明性を持って攻撃面と緩和策を明示することで、コミュニティからの脆弱性発見を歓迎します。

This document publishes the prompt injection defense design of `@sugukuru/mcp-houjin-bangou`. We transparently disclose our attack surface and mitigations to welcome vulnerability reports from the community.

Dokumen ini menjelaskan pertahanan prompt injection di `@sugukuru/mcp-houjin-bangou`.

## 参考文献 / References

- Simon Willison, ["Model Context Protocol has prompt injection security problems"](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/), 2025-04-09
- Invariant Labs, "Tool Poisoning Attacks" / "WhatsApp MCP Exploited"
- Elena Cross, ["The "S" in MCP Stands for Security"](https://elenacross7.medium.com/), 2025
- OWASP MCP Security Cheat Sheet, 2026
- MCP 公式仕様 (2025-11-25) Security and Trust & Safety section

## 攻撃面と緩和策

### 1. Rug Pull (Silent Redefinition)

**攻撃**: インストール後に tool 定義が静かに書き換わり、Day 7 に別の挙動になる。

**本プロジェクトの緩和**:

- **Tool description は `src/tools/*.ts` 内の静的定数 (`DESCRIPTION`)** で定義。ランタイム書換禁止
- **`eslint.config.js` で `no-new-func`, `no-eval`, `no-implied-eval` を error** に設定
- **静的 tool description + no runtime mutation**。`initialize` で `listChanged: false` を返し、起動後に tool / prompt / resource 定義を変更しない
- **`/.well-known/mcp.json` に Server Card（`version: "1.0.0"`）を公開**し、不意のバージョン変更を発見可能

### 2. Tool Shadowing (Cross-Server)

**攻撃**: 同じ MCP ホスト内で複数サーバが動作しているとき、悪意ある別サーバが信頼できる tool の挙動を上書き。

**本プロジェクトの緩和**:

- **状態を持たない stateless mode** で動作 → shadowing の攻撃面を提供しない
- **namespace 明示**: パッケージ名 `@sugukuru/mcp-houjin-bangou` でツール所有を可視化
- **MCP ホストの責任領域**: 本サーバーから他サーバーへのツール呼び出しは一切行わない (sampling capability も未宣言)

### 3. Tool Poisoning

**攻撃**: tool description に隠し命令を埋め込み (`<IMPORTANT>...read ~/.cursor/mcp.json...</IMPORTANT>`)、LLM に間接的な挙動を指示。

**本プロジェクトの緩和**:

- **すべての tool description は人間可読のみ**。`<IMPORTANT>` や HTML タグ風メタ命令を含めない
- **CI で description の grep 検知** — `.github/workflows/ci.yml` で `rg '<IMPORTANT|<instruction|<system|ignore previous' src/tools/` を実行、検出時 fail
- **Tool input parameter にフリースロット型フィールド (`sidenote`, `context`, `metadata`, etc.) を設けない** — Zod strict + 必要最小限のフィールドのみ
- **すべての output に `attribution` 必須化** — LLM が「この情報の出所」を user に伝えられるため、誤情報の出所追跡が可能
- **Application ID は環境変数 (`NTA_APPLICATION_ID`) のみ、tool 引数経由で受け取らない** — sidenote 型インジェクション経路を構造的に阻止

### 4. Response-Mediated Injection

**攻撃**: 法人名フィールドに `<IMPORTANT>...</IMPORTANT>` を含む悪意ある法人名が登録された場合、LLM が指示を読んで誤動作。

**本プロジェクトの緩和**:

- **すべての output を JSON 文字列および定型テキスト要約としてシリアライズ**、raw HTML 化しない
- **MCP Apps UI Resource (`ui://corporate-card/mcp-app.html`, `ui://corporate-search-results/mcp-app.html`) では `textContent` のみを使用し `innerHTML` を一切使わない**（XSS・DOM インジェクションを構造的に排除）
- **`attribution.data_source_label` を含む国税庁正式出典表記** を明示、ユーザーが独立検証可能

### 5. Confused Deputy (Read-Only の逆手利用)

**攻撃**: read-only とはいえ、LLM が tool を濫用して過剰リクエストを発生させる (DoS、情報exfiltration 補助)。

**本プロジェクトの緩和**:

- **ローカル版: 1 RPS 制限の token bucket + 指数バックオフ** — 国税庁 API の 403 (別添1 第9条第1項三号) を受ける前に内部で抑制
- **ホスト版: Origin ホワイトリスト検証 + IP 単位レート制限（バースト30 / 60 req/min, `Retry-After` 付与）+ リクエストボディ上限 64kB**
- **ホスト版 DB 権限分離**: API サーバーは SELECT のみを持つ `houjin_reader` ロールで接続し、DB 書き換えを構造的に不可能化
- **単一番号照会およびページサイズ上限（1〜100件）** を Zod で強制、バルク攻撃を構造的に阻止
- **Application ID・認証情報の redaction** およびツール引数（照会した番号・商号）の非ログ化により exfiltration を防御

## 設計方針 (Design Principles)

### Read-Only な性質を最大の防御に活用

本サーバは **書き込み・削除・コマンド実行系の tool を持たない**。すべての tool annotations に:

```typescript
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
}
```

を明示（外部通信の有無に応じて `openWorldHint` をツールごとに設定）。

### "When NOT to use" を必須記載

2026 MCP ベストプラクティスに従い、すべての tool description に **"USE THIS WHEN" + "DO NOT USE WHEN"** を構造化して記載。LLM の disambiguation を構造的に支援し、誤ったツール選択による副作用を減らす。

### Confidential 情報を tool の入出力に通さない設計

- `NTA_APPLICATION_ID` / `DATABASE_URL` は `src/lib/env.ts` の起動時検証のみ、tool 引数経由で受け取らない
- ログ出力時は `redactSensitive()` (`src/lib/mcp-logger.ts`) で自動マスク
- `src/server.ts` の pino redact paths で HTTP リクエストのヘッダも自動 redact

## ホスト側への推奨 (Host-Side Recommendations)

本 MCP サーバを使用する MCP クライアント (Claude Desktop / Cursor / VS Code Copilot 等) には以下を推奨:

1. **Tool description を UI でユーザに提示** — インストール時・初回使用時に静的 description を表示
2. **Tool call の full parameters を confirmation UI で表示** — Simon Willison が強く推奨する "no hidden horizontal scrollbars"
3. **複数 MCP サーバーの同時使用時は namespace を可視化** — cross-server shadowing への user-side defense

## コミュニティへ

本ドキュメントは完全版ではありません。**攻撃ベクターの発見を歓迎します**。

- セキュリティ脆弱性の報告: `info@sugu-kuru.co.jp` または GitHub private security advisory
- 緩和策の改善提案: PR または Issue で `security` ラベル付与
- 共同研究: OWASP MCP Security Cheat Sheet / Invariant Labs / Simon Willison コミュニティとの連携

更新履歴:

- 2026-05-22: v0.1.0 初版
- 2026-10-18: v1.0.0（凍結仕様 v1.7、MCP Apps UI `textContent` 徹底、HTTP Origin/RateLimit、DB 3ロール分離を反映）
