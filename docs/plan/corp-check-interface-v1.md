# 取引先確認MCP インターフェース仕様書 v1（凍結版）

- **作成日**: 2026-10-12 JST
- **対象ブランチ**: `a-kabe/corp-check-b0-interface-freeze`
- **目的**: 2026-10-24 の Claudeコネクタディレクトリ および ChatGPTアプリディレクトリ 提出に向けた全ツール・プロンプト・リソースのインターフェースの確定と凍結
- **ステータス**: 壁（代表・意思決定者）による承認待ち

---

## 1. 全ツール一覧とインターフェース仕様

提出時点において提供するツールの一覧、入出力スキーマ、およびアノテーション4種の値とその設定理由を以下に定めます。

### 1.1 `lookup_corporate_by_number`

- **既存の扱い**: 変更あり
  - 変更内容: 内部メタデータ（リクエストID、トレースID、内部タイムスタンプ）を除外し、データの時点（`data_as_of`）および出典表示（`attribution`）を標準形式で返却する。インボイス登録状態の付加情報はB5ゲート通過時のみオプショナルで追加する。
- **名前**: `lookup_corporate_by_number`
- **説明文（日本語）**: 13桁の法人番号を指定して、国税庁法人番号公表サイトにおける最新の登記基本情報（法人名、本店所在地、法人種別、登記更新日等）を取得します。
- **説明文（英語）**: Look up official corporate registry information by 13-digit Japanese national corporate number from NTA public records.
- **アノテーション**:
  - `title`: "Lookup Corporate Registry by 13-digit Number"
  - `readOnlyHint`: `true`
    - **設定理由**: 国税庁の公表データを参照するのみであり、外部リソースの作成・変更・削除を行わないため。
  - `destructiveHint`: `false`
    - **設定理由**: データの破壊・消去・上書きなどの副作用を生じさせないため。
  - `idempotentHint`: `true`
    - **設定理由**: 同一の法人番号に対する参照は、同一データ時点において同一の結果を返すため。
  - `openWorldHint`: `true`
    - **設定理由**: 国税庁の外部公表データを参照するため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "corporate_number": {
        "type": "string",
        "description": "13-digit Japanese national corporate number (digits only, e.g., '9340001026142')",
        "pattern": "^[0-9]{13}$"
      }
    },
    "required": ["corporate_number"]
  }
  ```
- **出力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "corporation": {
        "type": "object",
        "properties": {
          "corporate_number": { "type": "string" },
          "name": { "type": "string" },
          "name_kana": { "type": ["string", "null"] },
          "legal_type": { "type": "string" },
          "location": { "type": "string" },
          "post_code": { "type": ["string", "null"] },
          "update_date": { "type": "string" },
          "status": { "type": "string" }
        },
        "required": ["corporate_number", "name", "legal_type", "location", "update_date", "status"]
      },
      "invoice_status": {
        "type": ["object", "null"],
        "description": "Invoice issuer status if verified; null if invoice lookup is inactive",
        "properties": {
          "is_registered": { "type": "boolean" },
          "registration_number": { "type": "string" },
          "status": { "type": "string" }
        }
      },
      "data_as_of": {
        "type": "string",
        "description": "Date of the public dataset (YYYY-MM-DD)"
      },
      "attribution": {
        "type": "string",
        "description": "Attribution text required by NTA terms of service"
      }
    },
    "required": ["corporation", "data_as_of", "attribution"]
  }
  ```
- **UIリソース**: `ui://corporate-card/mcp-app.html` を返却する。

---

### 1.2 `search_corporate_by_name`

- **既存の扱い**: 変更あり
  - 変更内容: レスポンス肥大化によるコンテキスト圧迫を避けるため、既定取得件数を10件（最大20件）とし、ページネーション用カーソル（`cursor` / `next_cursor`）を導入する。内部メタデータを除外する。
- **名前**: `search_corporate_by_name`
- **説明文（日本語）**: 法人名（商号）から法人番号や所在地を検索します。検索結果は既定10件ずつ返却され、続きがある場合はカーソルを使用してページネーション取得できます。
- **説明文（英語）**: Search Japanese corporations by company name with pagination support (default 10 results per page, max 20).
- **アノテーション**:
  - `title`: "Search Corporations by Name"
  - `readOnlyHint`: `true`
    - **設定理由**: 公表データに対する読み取り専用の検索クエリであり、状態変更を伴わないため。
  - `destructiveHint`: `false`
    - **設定理由**: 副作用を持たず、データを破棄しないため。
  - `idempotentHint`: `true`
    - **設定理由**: 同一の検索条件・カーソルでの取得結果は、同一データ時点において同一であるため。
  - `openWorldHint`: `true`
    - **設定理由**: 外部の公表法人データベースを検索するため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Corporate name to search (kanji, kana, or romaji, e.g., 'スグクル')",
        "minLength": 1,
        "maxLength": 100
      },
      "prefecture": {
        "type": "string",
        "description": "Optional 2-digit prefecture code (01-47)",
        "pattern": "^(0[1-9]|[1-3][0-9]|4[0-7])$"
      },
      "cursor": {
        "type": "string",
        "description": "Opaque cursor for pagination returned from previous search"
      },
      "limit": {
        "type": "integer",
        "description": "Number of results to return (default: 10, max: 20)",
        "minimum": 1,
        "maximum": 20,
        "default": 10
      }
    },
    "required": ["name"]
  }
  ```
- **出力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "results": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "corporate_number": { "type": "string" },
            "name": { "type": "string" },
            "legal_type": { "type": "string" },
            "location": { "type": "string" },
            "update_date": { "type": "string" }
          },
          "required": ["corporate_number", "name", "legal_type", "location", "update_date"]
        }
      },
      "total_count": {
        "type": ["integer", "null"],
        "description": "Total number of matched corporations if known"
      },
      "next_cursor": {
        "type": ["string", "null"],
        "description": "Cursor token for fetching the next page; null if no more items"
      },
      "data_as_of": {
        "type": "string",
        "description": "Date of the public dataset (YYYY-MM-DD)"
      },
      "attribution": {
        "type": "string",
        "description": "Attribution text required by NTA terms of service"
      }
    },
    "required": ["results", "next_cursor", "data_as_of", "attribution"]
  }
  ```
- **UIリソース**: `ui://search-results/mcp-app.html` を返却する。

---

### 1.3 `lookup_invoice_issuer`

- **既存の扱い**: 追加（新設ツール）
  - 目的: 適格請求書発行事業者の登録番号（T+13桁）から公表サイトの登録事実を確認する。
  - 注意: 個人の場合は氏名・屋号を返却せず、税理士法に配慮して仕入税額控除の可否等の税務上の判断は返却しない [出典-A5, 出典-A6]。
- **名前**: `lookup_invoice_issuer`
- **説明文（日本語）**: 適格請求書発行事業者の登録番号（T+13桁）から、国税庁インボイス公表サイトにおける公表事実（登録状態、登録年月日、取消・失効年月日、法人の場合は公表商号・所在地）を確認します。任意の基準日を指定してその時点での有効性も照会可能です。個人の場合は氏名・屋号を返却せず、税務上の控除判断は行いません。
- **説明文（英語）**: Look up registered invoice issuer status by T-number (T+13 digits) from NTA public records with optional reference date. Returns factual registration status only without tax advice.
- **アノテーション**:
  - `title`: "Lookup Registered Invoice Issuer by T-number"
  - `readOnlyHint`: `true`
    - **設定理由**: 公表データの参照のみを行い、外部状態の変更を行わないため。
  - `destructiveHint`: `false`
    - **設定理由**: 破壊的処理を行わないため。
  - `idempotentHint`: `true`
    - **設定理由**: 同一番号・同一基準日での問い合わせは、同一データ時点において同一の事実結果を返すため。
  - `openWorldHint`: `true`
    - **設定理由**: 国税庁の適格請求書発行事業者公表データを参照するため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "registration_number": {
        "type": "string",
        "description": "Registered invoice issuer number (starts with 'T' followed by 13 digits, e.g., 'T9340001026142')",
        "pattern": "^T[0-9]{13}$"
      },
      "reference_date": {
        "type": "string",
        "description": "Optional reference date in 'YYYY-MM-DD' format to check registration status as of that date",
        "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"
      }
    },
    "required": ["registration_number"]
  }
  ```
- **出力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "registration_number": { "type": "string" },
      "status": {
        "type": "string",
        "enum": ["registered", "cancelled", "expired", "not_found"],
        "description": "Registration status as of data_as_of (or reference_date)"
      },
      "business_type": {
        "type": "string",
        "enum": ["corporation", "individual", "other", "unknown"],
        "description": "Classification of issuer"
      },
      "registration_date": {
        "type": ["string", "null"],
        "description": "Date of initial registration (YYYY-MM-DD)"
      },
      "cancellation_date": {
        "type": ["string", "null"],
        "description": "Date of cancellation if applicable (YYYY-MM-DD)"
      },
      "expiration_date": {
        "type": ["string", "null"],
        "description": "Date of expiration if applicable (YYYY-MM-DD)"
      },
      "corporate_name": {
        "type": ["string", "null"],
        "description": "Public corporation name if business_type is corporation; null for individuals"
      },
      "location": {
        "type": ["string", "null"],
        "description": "Public corporation location if business_type is corporation; null for individuals"
      },
      "is_active_on_reference_date": {
        "type": ["boolean", "null"],
        "description": "Whether the issuer was active on reference_date if reference_date was specified"
      },
      "data_as_of": {
        "type": "string",
        "description": "Date of the public dataset (YYYY-MM-DD)"
      },
      "attribution": {
        "type": "string",
        "description": "Attribution text required by NTA invoice site terms of service"
      },
      "tax_disclaimer": {
        "type": "string",
        "description": "Notice that this tool provides public facts only and does not provide tax consultation or deduction determination"
      }
    },
    "required": ["registration_number", "status", "business_type", "data_as_of", "attribution", "tax_disclaimer"]
  }
  ```
- **UIリソース**: なし（UI非対応クライアントでもテキストで用が足りるよう、構造化テキストのみで返却する）。

---

### 1.4 `validate_corporate_number`

- **既存の扱い**: 変更なし
- **名前**: `validate_corporate_number`
- **説明文（日本語）**: 13桁の法人番号の形式およびモジュラス9（ウェイト1-2方式）によるチェックデジットをローカルで検証します（外部通信なし）。
- **説明文（英語）**: Validate the 13-digit corporate number format and check digit using Modulus 9 without external network calls.
- **アノテーション**:
  - `title`: "Validate Corporate Number Check Digit (Local)"
  - `readOnlyHint`: `true`
    - **設定理由**: 純粋な算術的検証関数であり、副作用を持たないため。
  - `destructiveHint`: `false`
    - **設定理由**: 破壊的処理を行わないため。
  - `idempotentHint`: `true`
    - **設定理由**: 入力値に対して決定論的な結果を返す純粋関数のため。
  - `openWorldHint`: `false`
    - **設定理由**: 外部ネットワークやデータベースを参照せず、ローカル計算のみで完結するため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "corporate_number": {
        "type": "string",
        "description": "13-digit corporate number string to validate",
        "pattern": "^[0-9]{13}$"
      }
    },
    "required": ["corporate_number"]
  }
  ```
- **出力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "is_valid_format": { "type": "boolean" },
      "is_valid_check_digit": { "type": "boolean" },
      "error_reason": { "type": ["string", "null"] }
    },
    "required": ["is_valid_format", "is_valid_check_digit"]
  }
  ```
- **UIリソース**: なし。

---

### 1.5 `get_attribution`

- **既存の扱い**: 変更あり
  - 変更内容: 法人番号利用規約第6条に加え、適格請求書発行事業者公表システム利用規約第6条に基づく表示、および税務上の判断を行わない旨の免責文言を整理して返却する。
- **名前**: `get_attribution`
- **説明文（日本語）**: 国税庁の公表データ利用規約に基づく公式な帰属表示（クレジット）文言および免責事項を取得します。
- **説明文（英語）**: Retrieve the mandatory legal attribution text and disclaimers required by the National Tax Agency terms of service.
- **アノテーション**:
  - `title`: "Get NTA Legal Attribution and Disclaimers"
  - `readOnlyHint`: `true`
    - **設定理由**: 静的な規約文言の取得のみを行うため。
  - `destructiveHint`: `false`
    - **設定理由**: 副作用を持たないため。
  - `idempotentHint`: `true`
    - **設定理由**: 常に同一の規約文言を返却するため。
  - `openWorldHint`: `false`
    - **設定理由**: 静的な定義文言を返すため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {},
    "required": []
  }
  ```
- **出力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "corporate_number_attribution": { "type": "string" },
      "invoice_attribution": { "type": "string" },
      "tax_disclaimer": { "type": "string" }
    },
    "required": ["corporate_number_attribution", "invoice_attribution", "tax_disclaimer"]
  }
  ```
- **UIリソース**: なし。

---

### 1.6 `normalize_company_name`

- **既存の扱い**: 変更なし
- **名前**: `normalize_company_name`
- **説明文（日本語）**: 企業名の表記ゆれ（全角・半角英数字、(株)や株式会社の表記位置、特殊記号、スペース等）を正規化します（ローカル処理）。
- **説明文（英語）**: Normalize company name variations (full/half-width, corporate type abbreviations like (株) to 株式会社) locally.
- **アノテーション**:
  - `title`: "Normalize Company Name (Local)"
  - `readOnlyHint`: `true`
    - **設定理由**: 純粋な文字列変換関数であり副作用を持たないため。
  - `destructiveHint`: `false`
    - **設定理由**: 破壊的処理を行わないため。
  - `idempotentHint`: `true`
    - **設定理由**: 同一文字列に対して常に同一の正規化結果を返すため。
  - `openWorldHint`: `false`
    - **設定理由**: 外部通信を行わないため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "raw_name": {
        "type": "string",
        "description": "Raw company name string to normalize",
        "minLength": 1,
        "maxLength": 200
      }
    },
    "required": ["raw_name"]
  }
  ```
- **出力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "normalized_name": { "type": "string" },
      "legal_type": { "type": ["string", "null"] },
      "search_query_optimized": { "type": "string" }
    },
    "required": ["normalized_name", "search_query_optimized"]
  }
  ```
- **UIリソース**: なし。

---

### 1.7 `validate_invoice_number`（追加検討・保留）

- **扱い**: **保留（B5ゲート次第）**
- **理由**: 個人事業者の登録番号が法人番号と同一のモジュラス9（ウェイト1-2方式）チェックデジット計算に従うかについて、国税庁の一次資料による確認が未完了のため（実装指示書 v1 §3「調査レポートの訂正」および§5 B5ゲート）。
- **ゲートの判定基準**:
  - B5着手時に一次資料で計算ロジックが確認できた場合: ツールを追加する。
  - 確認できない場合: ツールは追加せず、`lookup_invoice_issuer` の入力検証（`^T[0-9]{13}$` フォーマット照合）のみとする。

---

## 2. Promptsの扱い（3本、入力最小化後の姿）

OpenAI Apps Developer Guidelines のデータ最小化要件 [出典-B2] に沿うよう、プロンプトの入力項目から個人の連絡先を排除し、法人特定に必要な最小限の情報のみを受け取る仕様とします。

### 2.1 `business-card-to-database`

- **変更内容**: 名刺の全文（`raw_business_card_text`）を受け取る設計を廃止し、会社名と所在地ヒントのみを受け取る形に変更する。個人の氏名・役職・電話番号・メールアドレス等の個人情報（PII）を入力項目から除外する。
- **説明文**: 名刺に記載された企業名から法人番号や登記情報を検索・照合し、社内データベース用の取引先企業マスタレコードを生成します。※個人の氏名・役職・電話番号・メールアドレス等の連絡先情報は入力しないでください。
- **引数（Arguments）**:
  - `company_name`: string（必須。名刺に記載された会社名・商号）
  - `location_hint`: string（任意。名寄せの絞り込みに用いる都道府県や市区町村）

### 2.2 `customer-master-dedup`

- **変更内容**: 既存の取引先マスタ名寄せ支援。入力項目を目的に必要な最小限に保つ。
- **説明文**: 既存の顧客・取引先マスタの社名・住所から、国税庁の公表法人情報と突合して正式名称・法人番号を特定し、名寄せ・表記ゆれの統一を支援します。※個人の連絡先情報は入力しないでください。
- **引数（Arguments）**:
  - `target_company_name`: string（必須。名寄せ対象の会社名）
  - `current_address`: string（任意。照合用の住所）

### 2.3 `sales-list-enrichment`

- **変更内容**: 営業先企業リストの法人番号・登記情報補完。
- **説明文**: 企業名のリストから法人番号・登記上の所在地・法人種別を一括検索し、企業リストを補完します。※個人の連絡先情報は入力しないでください。
- **引数（Arguments）**:
  - `company_list_text`: string（必須。企業名一覧。1行に1社）

---

## 3. UIリソースの扱い

どのツールがどのUIリソースを返却するかを以下のように定めます。

| ツール名 | 返却するUIリソースURI | 内容 |
| :--- | :--- | :--- |
| `lookup_corporate_by_number` | `ui://corporate-card/mcp-app.html` | 法人の商号、法人番号、所在地、登記更新日等の詳細カード表示 |
| `search_corporate_by_name` | `ui://search-results/mcp-app.html` | 検索結果一覧（既定10件、最大20件）のリスト表示 |
| `lookup_invoice_issuer` | なし（構造化テキストのみ） | UI非対応クライアントでもテキストのみで用が足りる設計とする |
| `validate_corporate_number` | なし | 判定結果（真偽値）のみ |
| `get_attribution` | なし | 規約文言のみ |
| `normalize_company_name` | なし | 正規化後文字列のみ |

- **UI下部のクレジット表示**:
  - 実装指示書 v1 §4 の仮定数に従い、案(a) `UI_CREDIT = "提供：スグクル株式会社"`（リンクなし）を仮置きする。

---

## 4. 出力に必ず含める項目・含めない項目

### 4.1 必ず含める項目
1. **データの時点（`data_as_of`）**:
   - 参照した公表データの日付（"YYYY-MM-DD"形式）。
2. **出典表示（`attribution`）**:
   - 法人番号情報: 国税庁法人番号システム利用規約第6条に基づく明示文言 [出典-A1]。
   - インボイス情報: 適格請求書発行事業者公表システム利用規約第6条に基づく明示文言 [出典-A3]。

### 4.2 含めない項目
1. **リクエストID（`requestId`）** / **トレースID（`traceId`）**:
   - 応答サイズ最小化および内部情報の不要な露出防止のため除外する。
2. **内部タイムスタンプ（`internal_timestamp`, `processed_at` 等）**:
   - データの時点（`data_as_of`）のみを残し、内部処理時刻は除外する。
3. **税務上の判断**:
   - 「仕入税額控除の対象となる/ならない」「控除可能額」「適用税率」など、税理士法第2条第1項第3号および第52条に抵触する恐れのある課税関係の判断や指導・助言 [出典-A6] は出力に含めない設計とする。

---

## 5. 出典一覧

- **[出典-A1]**: 国税庁 法人番号システムWeb-API機能利用規約（令和8年9月24日施行）第6条
- **[出典-A3]**: 国税庁 適格請求書発行事業者公表システムWeb-API機能利用規約（令和8年9月21日施行）第6条
- **[出典-A5]**: 国税庁 公表情報ダウンロード リソース定義書（個人事業者項目の非公表仕様）
- **[出典-A6]**: e-Gov法令検索 税理士法（昭和二十六年法律第二百三十七号）第2条、第52条
- **[出典-B2]**: OpenAI Developers Apps SDK Developer Guidelines（データ最小化要件）
