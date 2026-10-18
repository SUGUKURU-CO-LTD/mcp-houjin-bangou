# Troubleshooting / トラブルシューティング

## 起動時エラー

### `Error: Invalid environment variables: NTA_APPLICATION_ID: Required`

**原因**: `NTA_APPLICATION_ID` 環境変数が未設定。

**対処**:

- Claude Desktop: `claude_desktop_config.json` の `env.NTA_APPLICATION_ID` を設定
- CLI: `NTA_APPLICATION_ID=xxx npx -y @sugukuru/mcp-houjin-bangou`
- `.env` ファイル: `cp .env.example .env` して値を書く

### `EADDRINUSE: address already in use :::3001`

**原因**: ポート 3001 が既に使用中。

**対処**: `PORT=4000` 等で別ポートを指定。

## API エラー

### 本番 ID が届いた後の最初の確認

```bash
NTA_APPLICATION_ID=your-id pnpm smoke:live
```

このコマンドは ID を出力せず、サンプル法人番号で `/4/num` と `/4/name` を確認します。
仕様書に掲載されている番号は架空・削除済みの場合があるため、live smoke では本番 API で実在する法人番号 `7000012050002` を使います。

### 国税庁 HTTP 403 (レート制限)

> `NtaApiError: Rate limited by NTA. Backoff 30000ms applied. (別添1 第9条第1項三号)`

**原因**: 国税庁側で短時間大量アクセスの制限に引っかかった (別添1 第9条第1項三号)。

**対処**: 本ライブラリは自動的に 30秒 → 1分 → 5分 → 30分 の指数バックオフを適用。しばらく待てば自動復旧。

**根本原因の調査**:

- 複数インスタンスで同じ ID を使用していないか
- `NTA_RATE_LIMIT_RPS` を下げる (デフォルト 1)
- アクセス頻度のピーク時間を分散

### 国税庁 HTTP 404 (アプリケーション ID 無効)

> `NtaApiError: NTA API responded HTTP 404`

**原因** (国税庁仕様書 別紙2):

- アプリケーション ID が未登録
- アプリケーション ID が失効 (3 年間無利用で停止、別添1 第4条第5項)

**対処**:

1. ID が正しく設定されているか確認
2. 3 年無利用停止の場合は、適格請求書発行事業者公表サイトのフォームから再申請
3. 本プロジェクトには週次 keep-alive cron (`.github/workflows/api-health-check.yml`) があるため、GitHub Actions 側で設定すれば自動防止可能

### 国税庁 HTTP 400 (検索結果過多)

> `エラーコード 180: 検索結果件数が多いため結果をお返しできません。`

**原因**: `search_corporate_by_name` で絞り込みが弱く、ヒット件数が内部上限を超えた。

**対処**:

- `prefecture_code` パラメータで都道府県コード（JIS X 0401 2桁）を指定
- `city_name` パラメータで市区町村名を絞る
- `kind` パラメータで法人種別を絞る
- 会社名をより具体的に入力
- `match_mode: 'prefix'` に変更

### タイムアウト

> `NtaApiError: NTA API request timed out`

**原因**: 国税庁サーバの応答が 8 秒を超過。

**対処**:

- `NTA_TIMEOUT_MS` を増やす (デフォルト 8000ms)
- 国税庁側のメンテナンス時間を確認 (休祝日・年末年始は更新停止、第一編 §4 表2)

## MCP ホスト連携の問題

### Tool が MCP Host に表示されない

1. `claude_desktop_config.json` の JSON 構文エラーがないか確認
2. Claude Desktop / Cursor を完全に再起動
3. `curl -sX POST http://localhost:3001/mcp -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` で直接検証
4. サーバのログを確認 (`LOG_LEVEL=debug` で詳細化)

### Completion が効かない

`completion/complete` は MCP ホスト側の対応が必要です。現時点 (2026-10) で `Completion` をサポートするホスト:

- Claude Desktop (0.7.x+)
- MCP Inspector

サポート状況は日々変化します。

## 表記揺れ正規化の期待値ズレ

### T7 が期待通りの候補を返さない

1. 入力を `tools/call normalize_company_name` で直接試し、`applied_rules` を確認
2. 該当パターンが `src/domain/normalizer.ts` の `OLD_TO_NEW` / `KIND_KEYWORDS_JA` / `EN_SUFFIX_PATTERNS` に含まれているか確認
3. 含まれていなければ [Feature request](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/issues/new?template=feature_request.yml) を立てる

### 「この揺れは国税庁 `target=1` が吸収すべき」と判定された

国税庁 API の `target=1` は下記を自動で吸収します (第二編 §4.6.2):

- ひらがな → カタカナ
- 英小文字 → 英大文字
- 中点 (・)・全角スペース削除

これらは T7 では重複実装しません。`search_corporate_by_name` に `search_target: 'fuzzy'` を指定すると自動で処理されます。

## Node.js バージョン関連

### `ReferenceError: fetch is not defined`

**原因**: Node.js < 18 を使用。

**対処**: Node.js 20.19.0 以上に upgrade (`.nvmrc` 参照)。

## 詳細なログを取りたい

```bash
LOG_LEVEL=debug NTA_APPLICATION_ID=xxx npx -y @sugukuru/mcp-houjin-bangou
```

Application ID は自動的にログから redact されます。

## それでも解決しない場合

1. [SECURITY.md](../SECURITY.md) に該当するセキュリティ問題なら `info@sugu-kuru.co.jp`
2. それ以外は [GitHub Issues](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/issues) に `bug_report` テンプレで投稿
3. 国税庁 API 仕様変化を疑う場合は `api_drift` テンプレで投稿
