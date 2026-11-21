---
name: lookup-japan-corporate
description: 日本の国税庁公表データに基づく法人番号・企業情報照会、会社名の表記揺れ正規化、および適格請求書発行事業者（インボイス T+13桁）の登録事実確認プロトコル。取引先KYC、企業マスタ整備・名寄せ、請求書の登録番号チェックに使用する。
---

# 日本 国税庁 法人番号・インボイス照合スキル (`@sugukuru/mcp-houjin-bangou`)

国税庁の法人番号公表データおよび適格請求書発行事業者（インボイス）公表データを安全・正確に照会し、取引先確認（KYC）、企業マスタ整備・名寄せ、請求書の登録番号確認を行うための標準手順書です。

## 提供ツール（全5種）

1. **`normalize_company_name`**（ローカル純粋関数・両モード対応）
   - 入力: `raw_name`（1〜200文字）
   - 出力: `normalized_name`（正式法人格へ展開した商号）、`legal_type`（法人種別）、`search_query_optimized`（法人格を除いた検索用コア商号）
   - 前株/後株、`（株）`/`㈱`/`(有)` 等の略称、英語表記（`K.K.`, `Co., Ltd.`, `LLC` 等）、全角・半角英数字（NFKC）、旧字体→新字体（`髙→高`, `﨑→崎`, `齋→斎` 等）、異体字セレクタ（IVS）を決定論的に正規化します。
2. **`search_corporate_by_name`**（MCP Apps UI `ui://search-results/mcp-app.html` 対応）
   - 入力: `name`（必須、1〜100文字）、`prefecture`（任意、JIS X 0401 2桁コード `'01'`〜`'47'`）、`limit`（1〜20、既定10）、`cursor`（次ページ取得用トークン）
   - 出力: `results`（`corporate_number`, `name`, `legal_type`, `location`, `update_date`, `status`, `address_may_be_outdated`）、`total_count`, `next_cursor`, `data_as_of`, `attribution`
   - ※ ローカル Web-API モードでは略称展開や旧字体変換を自動実行しないため、曖昧な会社名は先に `normalize_company_name` に通してください（ホスト版DBでは完全一致・存続法人優先の2段階ランキングに加え、英数字・空白の半角/全角、主要旧字⇔新字、小書きカナ、ひらがな→カタカナ、略称・前後株にマッチし、1〜2文字は前方一致・3文字以上は部分一致で検索します）。
3. **`lookup_corporate_by_number`**（MCP Apps UI `ui://corporate-card/mcp-app.html` 対応）
   - 入力: `corporate_number`（半角数字13桁）
   - 出力: `corporation`（`corporate_number`, `name`, `name_kana`, `legal_type`, `location`, `post_code`, `update_date`, `status` [`active` | `closed`], `close_date`, `close_cause`, `successor_corporate_number`, `address_may_be_outdated`）、`data_as_of`, `attribution`
4. **`lookup_invoice_issuer`**（MCP Apps UI `ui://corporate-card/mcp-app.html` 対応・**ホスト版 / `DATA_SOURCE=db` 専用**）
   - 入力: `registration_number`（`T` + 半角数字13桁、例: `'T9340001026142'`）、`reference_date`（任意、`'YYYY-MM-DD'` 実在暦日）
   - 出力: `registration_number`, `status`（`registered` | `cancelled` | `expired` | `not_found`）、`business_type`（`corporation` | `individual` | `other` | `unknown`）、`registration_date`, `cancellation_date`, `expiration_date`, `corporate_name`, `location`, `was_registered_on_reference_date`, `data_as_of`, `attribution`, `tax_disclaimer`
   - **動作モード制約**: ホスト版（`https://houjin.mcp.sugu-kuru.co.jp/mcp`）またはローカル PostgreSQL モード（`DATA_SOURCE=db`）でのみ動作します。ローカル Web-API モード（`DATA_SOURCE=web-api`）では `DATA_UNAVAILABLE` を返します。
   - **個人事業者情報の非保持・非返却**: 個人事業者（`business_type: 'individual'`）については、氏名・屋号・通称・所在地をデータベースに一切保持せず、出力もしません（`corporate_name: null`, `location: null`）。
5. **`validate_corporate_number`**（ローカル純粋関数・両モード対応）
   - 入力: `corporate_number`（半角数字13桁）
   - 出力: `is_valid_format`, `is_valid_check_digit`, `error_reason`
   - 外部通信なしでモジュラス9（ウェイト1-2方式）のチェックデジットを計算検証します（※実在は保証しません）。

---

## 推奨ワークフロー（ゴールデンパス）

### 1. 会社名から法人番号・基本情報・インボイス登録を特定する
1. **商号の正規化**: 略称・旧字体・英字・前後株の揺れがある場合は、まず `normalize_company_name` に `raw_name` を渡す。
2. **候補検索**: 得られた `normalized_name`（ヒットしない場合や Web-API 前方一致モードでは `search_query_optimized`）を `search_corporate_by_name` に渡す。所在地の手がかりがある場合は都道府県を2桁コード（北海道=`01`, 東京都=`13`, 大阪府=`27`, 福岡県=`40`, 鹿児島県=`46` 等）に変換して `prefecture` に指定する。
3. **詳細照会**: 特定した `corporate_number`（13桁）を `lookup_corporate_by_number` に渡し、正式商号・フリガナ・郵便番号・閉鎖状況（合併時は `successor_corporate_number` で承継先法人も追跡可能）・住居表示注記（`address_may_be_outdated`）を確認する。
4. **インボイス確認（必要な場合）**: 法人の登録番号は `'T' + corporate_number` で構成されるため、`lookup_invoice_issuer` に渡して登録状態を確認する。

### 2. 請求書・領収書のインボイス登録番号（`T`+13桁）を監査する
1. 利用者が明示した登録番号（`T` + 半角数字13桁）と、請求日・取引日がある場合は `reference_date`（`YYYY-MM-DD`）を指定して `lookup_invoice_issuer` を実行する。
2. 返却された以下の事実を確認して提示する：
   - `status`（`registered`: 登録有効 / `cancelled`: 取消済 / `expired`: 失効済 / `not_found`: 公表データ該当なし）
   - `was_registered_on_reference_date`（基準日時点で有効な登録期間内であったかの事実照合結果。ただし `reference_date > data_as_of` の場合はデータ基準日時点の公表情報に基づく判定である旨の注記に留意）
   - 法人の場合は `corporate_name`・`location` と請求書記載の取引先名との整合性（個人事業者の場合は仕様上 `null` となるため、氏名・屋号は返却されない旨を説明する）

### 3. 法人番号の形式・チェックデジットだけを即座に検証する
1. 外部通信を行わずに13桁の番号の入力ミスを検知したい場合は、`validate_corporate_number` を実行する。

---

## 必須遵守事項（コンプライアンス・利用規約・税理士法）

- **`data_as_of` と `attribution` の明示**: 公表データの照会結果を回答に示す際は、必ずデータの基準日（`data_as_of`）とツールが返した出典文言（`attribution`）を改変せず併記してください（ホスト版は月1回・前月末時点の全件データ更新です）。
- **`not_found` の正確な解釈**: `lookup_invoice_issuer` の `status: 'not_found'` は「`data_as_of` 時点の公表データに一致するレコードがない」ことを示すものであり、未登録であることを確定するものではありません（月途中の新規登録で未反映等の可能性があります）。
- **1件ずつの照会限定（総当たり・一覧作成の禁止）**: `lookup_invoice_issuer` は利用者が明示した登録番号を1件ずつ確認する用途に限り使用してください。番号の範囲を連番で照会したり、登録事業者の一覧を作成したりする用途（法人に限った一覧を含む）には絶対に使用しないでください。
- **税務相談・控除可否判断の非提供（税理士法第2条）**: 仕入税額控除を受けられるか等を尋ねられた場合は、登録年月日や `was_registered_on_reference_date` 等の客観的な公表事実のみを示し、控除の可否は他の要件（記載事項・保存要件・経過措置等）にも依存するため、税理士または所轄税務署へ確認するよう案内してください。
- **個人情報の非入力**: 自然人の連絡先（担当者氏名・役職・電話番号・メールアドレス等）をツールやプロンプトに入力しないでください。
