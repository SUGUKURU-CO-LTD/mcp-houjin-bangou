# npm Publishing / npm 公開手順

## パッケージ情報 / Package Metadata

- **npm package**: `@sugukuru/mcp-houjin-bangou`
- **MCP Registry name**: `jp.co.sugu-kuru/mcp-houjin-bangou`
- **GitHub repository**: `SUGUKURU-CO-LTD/mcp-houjin-bangou`
- **現行バージョン / Current version**: `1.0.2`

## Trusted Publishing (GitHub OIDC) 構成

本リポジトリは長期の `NPM_TOKEN` シークレットを使用せず、GitHub Actions OIDC による **npm Trusted Publishing（Provenance 署名付き）** で公開しています（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）。

### npm 側の Trusted Publisher 設定項目

- **Package**: `@sugukuru/mcp-houjin-bangou`
- **Repository owner**: `SUGUKURU-CO-LTD`
- **Repository name**: `mcp-houjin-bangou`
- **Workflow filename**: `release.yml`

## リリース前ローカル検証手順 / Pre-Release Verification

タグ（`vX.Y.Z`）を作成する前に、以下のすべてがクリーンに通ることを確認します：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
pnpm audit
npm pack --dry-run
```

> **Note**: `package.json` の `prepublishOnly` スクリプトは `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run test` の順で自動実行されます。また、6つのマニフェスト（`package.json`, `src/version.ts`, `server.json`, `.well-known/mcp.json`, `plugin.json`, `.cursor-plugin/plugin.json`）の `version` フィールドを同一バージョンに揃えてから `v*.*.*` タグを push してください。
