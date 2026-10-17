# Contributing / 貢献方法 / Cara Berkontribusi

ご貢献ありがとうございます。本プロジェクトは Sugukuru OSS Lab の創設リポジトリです。

## 開発環境のセットアップ / Development Setup

必要:

- Node.js 20.19.0 (`.nvmrc` で固定)
- pnpm 9+
- 国税庁アプリケーション ID (開発時は検証環境推奨、第一編 §7)

```bash
git clone https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou.git
cd mcp-houjin-bangou
pnpm install
cp .env.example .env
# .env の NTA_APPLICATION_ID または DATABASE_URL を設定
pnpm test
pnpm dev
```

## Issue / PR のルール / Issue & PR Rules

### 3 言語ルール / Trilingual Rule

コメント、ドキュメント、README は **日本語 → English → Bahasa Indonesia** の順で
記述してください。コード変数・関数名は英語 (camelCase) のみ。

### Commit Message

Prefix と日本語 OK:

- `feat:` 新機能
- `fix:` バグ修正
- `docs:` ドキュメント
- `chore:` その他
- `refactor:` リファクタリング
- `test:` テスト追加

例: `feat: T7 normalizer に旧字体→新字体変換を追加`

### Branch

- `main` への直接 push は Admin のみ。他はPR。
- PR には必ず Issue 番号を紐付ける。

### PR checklist

- [ ] `pnpm test` が all green
- [ ] `pnpm typecheck` が clean
- [ ] `pnpm lint` が 0 warnings
- [ ] `CHANGELOG.md` に変更を追記
- [ ] コードコメント・ドキュメントは 3 言語で記述

## 表記揺れ lookup table への貢献

`src/domain/normalizer.ts` の lookup table に新しい表記揺れパターンを追加する際は:

1. `tests/unit/normalizer.test.ts` に該当ケースのテストを追加
2. 実際の法人データからの抽出例を PR description に記載
3. 国税庁 `target=1` が既に対応していないか確認 (第二編 §4.6.2)

## ADR (Architecture Decision Record)

大きな設計変更は `docs/adr/XXXX-title.md` に Michael Nygard 形式で記録。

## セキュリティ

セキュリティ上の問題は issue ではなく [SECURITY.md](SECURITY.md) 参照。
