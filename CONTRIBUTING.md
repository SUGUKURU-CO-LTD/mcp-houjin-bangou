# Contributing / 貢献ガイド

`@sugukuru/mcp-houjin-bangou` へのご貢献ありがとうございます。

## 開発環境のセットアップ / Development Setup

### 必要環境 / Prerequisites

- **Node.js**: `>= 20.19.0`（`.nvmrc` 参照）
- **pnpm**: `10+`（`corepack enable` 推奨）
- （任意）ローカルで DB 統合テストを実行する場合: **PostgreSQL 16+**（`pg_trgm` 拡張対応）
- （任意）ローカルで国税庁 Web-API モードの実通信確認を行う場合: 国税庁 Web-API アプリケーション ID

### セットアップ手順 / Quick Setup

```bash
git clone https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou.git
cd mcp-houjin-bangou
pnpm install --frozen-lockfile
cp .env.example .env
# 必要に応じて .env の NTA_APPLICATION_ID または DATA_SOURCE=db / DATABASE_URL を設定

# サーバー本体 + MCP Apps UI + CSP ハッシュをビルド
pnpm build

# 型検査・Lint・フォーマット検査・テスト実行
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

> **Note**: 一部の統合テスト（`dist/server.js` の起動検証やビルド済み UI リソース検証）は `pnpm build` の生成物を参照するため、初回テスト実行前に `pnpm build` を実行してください。また、実 PostgreSQL 16 を使用する統合テストは `DATABASE_URL`（または `TEST_DATABASE_URL`）が設定されている場合のみ実行されます。

## Issue / PR のルール / Issue & PR Guidelines

### ドキュメント・言語方針 / Documentation & Language Policy

- ユーザー向けの仕様・使い方の変更を行う場合は、**英語版 [`README.md`](README.md) と日本語版 [`README.ja.md`](README.ja.md) の両方**、および関連する `docs/` 配下のドキュメントを同期して更新してください。
- コードの変数名・関数名・型名は英語（`camelCase` / `PascalCase`）を使用し、MCP ツールの入出力プロパティ名は `snake_case` に統一します。
- テストデータ・フィクスチャ・ベンチマークには実在個人の情報や非公開の顧客データを絶対に含めず、合成データまたは公的機関の公表サンプルのみを使用してください。

### Commit Message

Conventional Commits プレフィックス + 日本語または英語で記述してください：

- `feat:` 新機能 / New feature
- `fix:` バグ修正 / Bug fix
- `docs:` ドキュメント / Documentation
- `chore:` ビルド・依存関係・雑務 / Chore
- `refactor:` リファクタリング / Refactor
- `test:` テスト追加・修正 / Tests
- `perf:` パフォーマンス改善 / Performance

例: `feat: normalizer に医療法人・学校法人等の法人種別正規化を追加`

### PR Checklist

- [ ] `pnpm typecheck` がエラー 0 件
- [ ] `pnpm lint` がエラー・警告 0 件（`src`, `tests`, `scripts`, `benchmarks`）
- [ ] `pnpm format:check` がすべてパス（LF 改行）
- [ ] `pnpm build && pnpm test` がすべてパス
- [ ] `pnpm audit` で既知の脆弱性が 0 件
- [ ] `CHANGELOG.md`（および必要な場合は `README.md` / `README.ja.md` / `docs/`）を更新

## 表記揺れ正規化（`src/domain/normalizer.ts`）への貢献

新しい表記揺れ・法人格・旧字体パターンを追加する際は：

1. `tests/unit/normalizer.test.ts`（および必要に応じて `normalizer.property.test.ts`）にテストケースを追加してください。
2. 国税庁 Web-API の `target=1`（第二編 §4.6.2: ひらがな↔カタカナ、英大小文字、中点削除）やホスト版 DB の半角/全角 ASCII 検索との役割分担を確認してください。

## ADR (Architecture Decision Record)

大きな設計判断・プロトコル仕様上の選択を行う場合は、`docs/adr/XXXX-title.md` に記録してください。

## セキュリティ / Security

セキュリティ上の脆弱性を発見した場合は、公開 Issue を立てず [SECURITY.md](SECURITY.md) の手順に従って報告してください。
