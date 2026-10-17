# npm Publishing / npm公開 / Publikasi npm

## Current package / 現在のパッケージ / Paket saat ini

- npm package: `@sugukuru/mcp-houjin-bangou`
- GitHub repository: `SUGUKURU-CO-LTD/mcp-houjin-bangou`
- Release tag: `v1.0.0`

## First publish checklist / 初回公開チェックリスト / Daftar periksa publikasi pertama

GitHub Actions already builds, tests, packs, and signs provenance correctly. The remaining blocker is npm-side package/scope setup.

GitHub Actions は build / test / pack / provenance 署名まで正常に動作している。残っているブロッカーは npm 側の package/scope 設定。

GitHub Actions sudah berhasil menjalankan build / test / pack / tanda tangan provenance. Penghalang yang tersisa adalah pengaturan package/scope di sisi npm.

1. Open npm account settings for `sugukuru`.
2. Confirm the `@sugukuru` scope exists and the account can publish public scoped packages.
3. In npm Trusted Publishing, create a package connection:
  - Package: `@sugukuru/mcp-houjin-bangou`
  - Repository owner: `SUGUKURU-CO-LTD`
  - Repository name: `mcp-houjin-bangou`
  - Workflow filename: `release.yml`
  - Environment: leave empty unless npm requires one
4. Re-run the GitHub Actions `Release` workflow for tag `v1.0.0`, or push the `v1.0.0` tag to the release commit.

## Evidence from failed run / 失敗ログの根拠 / Bukti dari log gagal

The release workflow reached npm provenance signing before failing:

Release workflow は npm provenance 署名までは到達している:

Workflow release sudah mencapai penandatanganan provenance npm sebelum gagal:

```text
npm notice publish Signed provenance statement with source and build information from GitHub Actions
npm notice publish Provenance statement published to transparency log
npm error 404 Not Found - PUT https://registry.npmjs.org/@sugukuru%2fmcp-houjin-bangou
npm error 404 '@sugukuru/mcp-houjin-bangou@0.2.0' is not in this registry.
```

This means the tarball and OIDC provenance path are healthy; npm has not accepted first publication for the scoped package yet.

これは tarball と OIDC provenance の経路は正常であり、npm が scoped package の初回公開をまだ受け付けていないことを意味する。

Ini berarti tarball dan jalur OIDC provenance sehat; npm belum menerima publikasi pertama untuk scoped package tersebut.

## Local verification snapshot / ローカル検証スナップショット / Snapshot verifikasi lokal

```text
pnpm typecheck
pnpm test
pnpm build
pnpm publish --dry-run --no-git-checks --access public

name: @sugukuru/mcp-houjin-bangou
version: 1.0.0
```

