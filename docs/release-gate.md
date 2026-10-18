# v0.2.0 Release Gate Checklist

> [!NOTE]
> 本チェックリストは v0.2.0 リリース当時のゲート記録です。現行の v1.0.0 のリリースゲートや受け入れ条件とは異なります。

Release date target: **2026-05-22**

## コード品質 / Code quality

- [x] `pnpm test` — 154/154 pass
- [x] `pnpm typecheck` — clean, 0 errors
- [x] `pnpm lint` — 0 errors (tests に 1 non-null assertion warning は許容)
- [x] `pnpm format:check` — all formatted
- [x] `pnpm build` — dist/ 生成、server.js 実行可能
- [ ] `pnpm test:coverage` で 80% 以上
- [x] `fast-check` property-based tests (11,500+ generated cases)
- [x] `pnpm bench` benchmark suite

## MCP プロトコル準拠 / MCP protocol compliance

- [x] `initialize` → protocolVersion 2025-11-25 ネゴシエーション成功
- [x] `tools/list` → 5 tools 返却
- [x] `resources/list` → attribution://houjin-bangou 返却
- [x] `resources/templates/list` → corp://{corporate_number} 返却
- [x] `completion/complete` → T7 正規化候補返却
- [x] `logging/setLevel` capability 宣言
- [ ] MCP Inspector (`mcp-inspector --cli http://localhost:3001/mcp`) で 6 primitives 全確認

## 各 Tool の動作 / Tool-level smoke tests

- [x] `lookup_corporate_by_number` (validate の smoke は合格、本番 API 検証は本番 ID で)
- [x] `search_corporate_by_name` (実装完了、本番 API 検証は本番 ID で)
- [x] `validate_corporate_number` (端末上で 5111101000006 → is_valid: true 検証済み)
- [x] `normalize_company_name` (端末上で `（株）高橋商事` → 3 候補 検証済み)
- [x] `get_attribution` (実装完了、出典文字列生成ロジック pass)
- [x] `pnpm smoke:live` (本番アプリケーション ID で `/4/num` + `/4/name` 確認)
  - 2026-05-10: `7000012050002` → `国税庁`, `/4/name` count=2, `NTA live smoke: OK`

## Server Card / 発見可能性

- [x] `/.well-known/mcp.json` が公開されている
- [x] Server Card JSON に 5 tools + 3 resources が列挙されている
- [x] `attribution` / `safety` / `specs_referenced` メタデータ完備

## セキュリティ / Security

- [x] Application ID の env 読込 & ログ redaction 動作確認
- [x] Rate limiter (1 RPS + exponential backoff) 単体テスト pass
- [x] Zod strict schema (additionalProperties: false) 全 tool で適用
- [x] Tool description は静的定数のみ、`<IMPORTANT>` 等なし
- [x] CI に prompt injection grep guard
- [x] `docs/security/prompt-injection-defense.md` で攻撃面を公開
- [ ] CodeQL weekly scan で 0 High/Critical
- [ ] `pnpm audit signatures` で signed dependencies 確認

## ドキュメント / Documentation

- [x] LICENSE (MIT)
- [x] SECURITY.md (3言語)
- [x] CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
- [x] CONTRIBUTING.md (3言語ルール + PR ルール)
- [x] CHANGELOG.md (Keep a Changelog)
- [x] README.md (英語、旗艦)
- [x] README.ja.md (日本語、旗艦)
- [x] ADR 0001-0010 (Michael Nygard 形式)
- [x] docs/architecture.md (Mermaid 図付き)
- [x] docs/getting-started.md (5 UC prompt 含む)
- [x] docs/troubleshooting.md
- [x] docs/security/prompt-injection-defense.md
- [x] docs/policy/privacy-policy.md
- [x] docs/policy/terms-of-service.md
- [x] examples/ (Claude Desktop + Cursor 設定)
- [x] .env.example

## CI/CD

- [x] `.github/workflows/ci.yml` (test + lint + typecheck + build + format + prompt injection guard)
- [x] `.github/workflows/release.yml` (provenance 付き npm publish)
- [x] `.github/workflows/codeql.yml` (weekly)
- [x] `.github/workflows/dependency-review.yml`
- [x] `.github/workflows/api-health-check.yml` (週次、3年無利用停止防止)
- [x] `.github/dependabot.yml` (weekly)
- [x] `.github/ISSUE_TEMPLATE/` (bug / feature / api_drift)
- [x] `.github/PULL_REQUEST_TEMPLATE.md`

## npm publish 準備 / npm publish readiness

- [x] `package.json`: scoped public `@sugukuru/mcp-houjin-bangou`
- [x] `package.json`: provenance friendly (publishConfig, files, bin)
- [x] `.npmignore` で不要ファイル除外
- [ ] npm Trusted Publishing (GitHub OIDC) が npmjs.com 側で設定されている
  - 初回公開手順: `docs/deployment/npm-publishing.md`
- [x] `pnpm publish --dry-run --access public` が成功 (250.6 kB / 151 files)
- [ ] `npm info @sugukuru/mcp-houjin-bangou` で name conflict なし

## リリースアナウンス / Release announcement

- [ ] Zenn 記事ドラフト完成 (`docs/articles/zenn-v0.2.0.md`)
- [ ] Zenn 記事公開
- [x] X / HN / 指名レビューは非露出方針で deprecated 化
- [ ] v0.2.0 実装ブランチの準備
- [ ] Sugukuru コーポレートサイトの「OSS」ページ更新
- [ ] Slack (#30-dev) に共有

## 法令・利用規約遵守 / Legal & ToS compliance

- [x] 全 tool output に `attribution` 必須化 (Zod required)
- [x] 別添1 第6条 の指定文言を `attribution.service_disclaimer` に埋め込み
- [x] 別添3 公共データ利用規約 第1.0版 を `attribution.license` に明記
- [x] Application ID を外部に譲渡しない運用 (別添1 第9条第1項五号)
- [x] 1 RPS で運用 (別添1 第9条第1項三号の「短時間大量アクセス」回避)

## 品質ゲート通過後の最終手順 / Final steps

1. npm 側で `@sugukuru/mcp-houjin-bangou` の Trusted Publishing を設定する
2. GitHub Actions `Release` workflow を `v0.2.0` で再実行する
3. GitHub Actions が自動で npm publish + GitHub Release 作成
4. npm レジストリで公開を確認 (`pnpm info @sugukuru/mcp-houjin-bangou`)
5. Zenn 記事公開後、すぐ次の実装に戻る

---

ℹ️ このチェックリストは v0.2.0 以降も更新されます。各 v_X.Y.Z 固有の差分は CHANGELOG.md で追跡してください。
