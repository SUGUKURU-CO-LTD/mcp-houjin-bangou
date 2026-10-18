# Usage Cookbook — 実務プロンプト例

本ドキュメントは、Claude / ChatGPT / Cursor / VS Code Copilot で本 MCP サーバーを使って取引先確認・経理照合・マスタ整備を行う具体例集です。

---

## 1. 法人番号のチェックデジットを検証する（外部通信なし）

> 法人番号 `5111101000006` は有効ですか？チェックデジットだけでいいのでローカルで確認して。

**使用ツール**: `validate_corporate_number` — ローカル計算のみ、DB や国税庁 API にはアクセスしません。

---

## 2. 法人番号から本店所在地とインボイス登録状況を同時に引く

> 法人番号 `5111101000006` の正式商号・本店所在地と、インボイス（適格請求書発行事業者）の登録状況を教えて。

**使用ツール**: `lookup_corporate_by_number` (`include_invoice_status: true`)

---

## 3. 請求書のインボイス登録番号（T番号）が取引日時点で有効か確認する

> 受け取った請求書に記載されている登録番号 `T1234567890123（※架空の番号例）` が、取引日 `2026-10-01` 時点で有効な登録期間内にあるか確認して。

**使用ツール**: `lookup_invoice_issuer` (`registration_number: "T1234567890123"`, `reference_date: "2026-10-01"`)

---

## 4. 会社名の表記揺れから法人番号を特定する

> 「（株）髙橋商事」という会社の法人番号と本店所在地を調べて。

**実行される呼出**: `normalize_company_name` → `search_corporate_by_name`

旧字体（髙→高）や前株・後株の展開候補を自動生成して検索します。

---

## 5. 表記揺れ候補だけを生成する（検索しない）

> 「SUGUKURU CO., LTD.」を国税庁の検索で使える日本語表記候補に変換して。

**使用ツール**: `normalize_company_name`

---

## 6. 都道府県・市区町村を指定して法人を検索する

> 鹿児島県霧島市の「スグクル」を含む法人を検索して。登記閉鎖済みも含めて。

**使用ツール**: `search_corporate_by_name` (`query: "スグクル"`, `prefecture_code: "46"`, `city_name: "霧島市"`, `include_closed: true`)

---

## 7. 取引先マスタ登録用レコードを作成する（Prompt: `company-master-record`）

> 会社名「（株）スグクル」、住所メモ「鹿児島県霧島市」から取引先マスタ登録用の法人情報を整形して。

**使用プロンプト**: `company-master-record` (`company_name`, `address_hint`)
※ 自然人の氏名や連絡先などの個人情報は入力・処理しません。

---

## 8. 営業・取引先リストに法人番号と住所を一括付与する（Prompt: `sales-list-enrichment`）

> 以下の会社名リストを調べて、法人番号・正式名称・本店所在地を Markdown テーブルでまとめて：
> - （株）高橋商事
> - スグクル株式会社

**使用プロンプト**: `sales-list-enrichment` (`company_names`, `output_format: "markdown_table"`)

---

## 9. 顧客マスタの重複レコードを名寄せする（Prompt: `customer-master-dedup`）

> 以下の顧客レコード（JSONL）を法人番号で名寄せして、重複グループを提示して：
> ```jsonl
> {"id":"C001","name":"(株)高橋商事","address":"鹿児島市..."}
> {"id":"C002","name":"株式会社高橋商事","address":"鹿児島市..."}
> ```

**使用プロンプト**: `customer-master-dedup` (`records_jsonl`, `dedup_criteria: "strict_corporate_number"`)

---

## 10. データの基準日（`data_as_of`）と出典を確認する

すべての照会ツール（`lookup_corporate_by_number`, `search_corporate_by_name`, `lookup_invoice_issuer`）の応答には、公表データの基準日（`data_as_of`）および国税庁の出典・免責情報（`attribution`）が自動的に含まれます。ホスト版では月1回（前月末時点のデータ）で更新されるため、月途中の最新変更を確認したい場合は国税庁の各公表サイトを直接参照してください。
