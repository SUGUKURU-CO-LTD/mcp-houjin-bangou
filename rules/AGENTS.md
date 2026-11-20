# Japan Corporate Number & Qualified Invoice Lookup Rules (`houjin-bangou`)

日本の法人番号（13桁）や適格請求書発行事業者（インボイス制度、`T`+13桁）の照会・検証、取引先マスタ整備（KYC・名寄せ）、請求書チェックを行う際は、`houjin-bangou` MCP サーバー（`@sugukuru/mcp-houjin-bangou`）のツールを以下の手順・規約に従って使用してください。

## ツール選択と標準ワークフロー

1. **会社名の表記揺れ正規化 (`normalize_company_name`)**
   - `search_corporate_by_name` は略称展開（`(株)` → `株式会社`）や旧字体変換（`髙` → `高`、`﨑` → `崎`）を自動で行いません。
   - 略称・前後株・旧字体・英語表記（`K.K.`, `Co., Ltd.` 等）を含む会社名を検索する際は、**最初に `normalize_company_name`（引数: `raw_name`）を呼び出し**、`normalized_name` または `search_query_optimized` を取得してください。
2. **法人名からの検索 (`search_corporate_by_name`)**
   - `name` に正規化後の商号またはコア商号を指定し、所在地が判明している場合は都道府県コード（JIS X 0401 の2桁 `'01'`〜`'47'`）を `prefecture` に指定してください。
   - 結果は最大20件（既定10件）ずつ返り、`next_cursor` がある場合は `cursor` に渡して次ページを取得できます（MCP Apps 対応クライアントでは `ui://search-results/mcp-app.html` が表示されます）。
3. **法人番号による詳細照会 (`lookup_corporate_by_number`)**
   - 13桁の `corporate_number`（半角数字のみ）を指定して、正式商号・フリガナ・本店所在地・郵便番号・法人種別・状態（`active` / `closed`）・閉鎖日・閉鎖事由・承継先法人番号（`successor_corporate_number`）・住居表示注記（`address_may_be_outdated`）を取得します（MCP Apps 対応クライアントでは `ui://corporate-card/mcp-app.html` が表示されます）。
4. **適格請求書発行事業者の登録確認 (`lookup_invoice_issuer`)**
   - `registration_number`（`T` + 半角数字13桁）と、取引日・請求日がある場合は `reference_date`（`YYYY-MM-DD`）を指定して登録状態と基準日時点の有効性（`was_registered_on_reference_date`）を確認します（MCP Apps 対応クライアントでは `ui://corporate-card/mcp-app.html` でインボイス確認カードが表示されます）。
   - ※ 本ツールはホスト版（`https://houjin.mcp.sugu-kuru.co.jp/mcp`）またはローカル DB モード（`DATA_SOURCE=db`）専用です。ローカル Web-API モード（`DATA_SOURCE=web-api`）では `DATA_UNAVAILABLE` となります。
5. **チェックデジットのローカル検証 (`validate_corporate_number`)**
   - 外部通信なしで13桁の法人番号のモジュラス9チェックデジットのみを検証する場合に使用します（※番号が実在することは保証しません）。

## 厳守事項（利用規約・個人情報保護・税理士法）

- **データ時点と出典の併記**: 公表データの照会結果を提示する際は、必ずレスポンスに含まれる `data_as_of`（データ基準日）と `attribution`（出典表示）をそのまま併記してください。
- **1件ずつの照会限定（総当たり禁止）**: `lookup_invoice_issuer` は利用者が明示した登録番号を1件ずつ確認するためにのみ使用し、番号範囲の連番探索や登録事業者リストの作成（法人限定を含む）には使用しないでください。
- **個人事業者情報の保護と `not_found` の扱い**:
  - 個人事業者（`business_type: 'individual'`）の氏名・屋号・所在地は保護のため保持・返却されません（`null`）。
  - `status: 'not_found'` は公表データ（月1回更新）上に該当レコードがないことを示し、未登録を確定するものではありません。
- **税務判断の非提供**: 仕入税額控除の可否等の税務判断は行わず、公表データ上の登録事実のみを回答したうえで、個別判断は税理士・税務署への確認を案内してください。
- **個人連絡先の非入力**: 担当者氏名・電話番号・メールアドレス等の個人情報をツールやプロンプトに渡さないでください。
