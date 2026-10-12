# 取引先確認MCP インターフェース仕様書 v1.5

- **作成日**: 2026-10-12 JST (v1.5更新)
- **対象ブランチ**: `a-kabe/corp-check-b2c-remove-resources`
- **目的**: 2026-10-24 の Claudeコネクタディレクトリ および ChatGPTアプリディレクトリ 提出に向けた全ツール・プロンプト・リソース・共通エラー・サーバー説明文のインターフェースの確定と凍結
- **ステータス**: v1.5（承認済み・凍結）

---

## 1. 全ツール一覧とインターフェース仕様

提出時点において提供するツールの一覧、入出力スキーマ、およびアノテーション4種の値とその設定理由を以下に定めます。

なお、提出（Claudeコネクタディレクトリ・ChatGPTアプリディレクトリ）における `openWorldHint` の値および設定理由は、ホスト版（Cloud Run）の動作に合わせて申請します。ローカル版（npx / Web-API直接呼出）実行時は、起動設定に応じて内部的に値が切り替わります（M5）。

| ツール名 | ホスト版 openWorldHint | ローカル版 openWorldHint | 理由（ホスト版 / 提出用） |
| :--- | :--- | :--- | :--- |
| `lookup_corporate_by_number` | `false` | `true` | 自社DBに保持した公表データの写しを読むだけで、外部システムへの接続・投稿・公開を行わないため |
| `search_corporate_by_name` | `false` | `true` | 自社DBに保持した公表データの写しを読むだけで、外部システムへの接続・投稿・公開を行わないため |
| `lookup_invoice_issuer` | `false` | `true` | 自社DBに保持した公表データの写しを読むだけで、外部システムへの接続・投稿・公開を行わないため |
| `validate_corporate_number` | `false` | `false` | 外部通信や公表データを参照せず、ローカル計算のみで完結するため |
| `normalize_company_name` | `false` | `false` | 外部通信を行わず、ローカル文字列正規化のみで完結するため |

---

### 1.1 `lookup_corporate_by_number`

- **既存の扱い**: 変更あり
  - 変更内容: 内部メタデータ（リクエストID、トレースID、内部タイムスタンプ）を除外し、データの時点（`data_as_of`）および出典表示（`attribution`）を標準形式で返却する。インボイス確認は `lookup_invoice_issuer` に一本化し、本ツールの出力スキーマには含めない（M2）。
- **名前**: `lookup_corporate_by_number`
- **説明文（日本語）**: 13桁の法人番号を指定して、国税庁が公表している法人の基本3情報（名称・所在地・法人番号）と、法人種別・更新年月日・閉鎖の有無を返します。データの時点を併せて返します。
- **説明文（英語）**: Given a 13-digit corporate number, returns corporate basic information published by Japan's National Tax Agency (name, location, corporate number), legal type, last update date and closure status, with the dataset date.
- **アノテーション**:
  - `title`: "Look up Corporation by Corporate Number"
  - `readOnlyHint`: `true`
    - **設定理由**: 公表データを参照するのみであり、外部リソースの作成・変更・削除を行わないため。
  - `destructiveHint`: `false`
    - **設定理由**: データの破壊・消去・上書きなどの副作用を生じさせないため。
  - `idempotentHint`: `true`
    - **設定理由**: 同一の法人番号に対する参照は、同一データ時点において同一の結果を返すため。
  - `openWorldHint`: `false`（ホスト版提出時。ローカル版は `true`）
    - **設定理由**: 自社DBに保持した公表データの写しを読むだけで、外部システムへの接続・投稿・公開を行わないため。
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
          "status": { "type": "string", "enum": ["active", "closed"] },
          "close_date": { "type": ["string", "null"], "description": "Date of closure (YYYY-MM-DD); null if active" },
          "close_cause": { "type": ["string", "null"], "description": "Reason for closure as published (e.g., liquidation, merger); null if active" }
        },
        "required": ["corporate_number", "name", "legal_type", "location", "update_date", "status"]
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
  - `openWorldHint`: `false`（ホスト版提出時。ローカル版は `true`）
    - **設定理由**: 自社DBに保持した公表データの写しを読むだけで、外部システムへの接続・投稿・公開を行わないため。
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
            "update_date": { "type": "string" },
            "status": { "type": "string", "enum": ["active", "closed"] }
          },
          "required": ["corporate_number", "name", "legal_type", "location", "update_date", "status"]
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
  - 目的: 適格請求書発行事業者の登録番号（T+13桁）から公表サイトの登録事実を確認する。国税庁インボイス公表サイト利用規約に基づき公共データ利用規約（第1.0版）準拠でダウンロードデータを利用可能であることを確認済み（2026-10-12、[出典-A7]）。
  - **個人情報保護および利用規約上の設計制約**:
    1. 個人事業者の登録番号は、公表サイト利用規約上、個人情報として扱われる（同サイトから取得した個人情報を本人の同意なく公表した場合、個人情報保護法に抵触するおそれがある旨が規約に明記されているため [出典-A7]）。
    2. 利用者が入力した登録番号に**完全一致した場合のみ**結果を返却し、一覧表示・範囲検索・一括出力の機能は設けない。
    3. 利用者が入力した登録番号および検索内容は、サーバーログに記録しない。
    4. 個人事業者の場合は氏名・屋号を返却しない [出典-A5]。
    5. 税理士法に配慮し、仕入税額控除の可否等の税務上の判断は返却しない [出典-A6]。
    6. ホスト版は、個人事業者の登録番号を含む公表データを自社DBに保持する（出典-A7により個人情報として扱う）。そのため次を行う。
       - 利用目的（受け取った請求書等の登録番号の有効性確認）を、プライバシーポリシーで公表する（B8）
       - 番号を順に試して一覧を作る行為を防ぐため、IP単位の利用上限を設け、超えた場合は `RATE_LIMITED` を返す（B6）
       - DBへのアクセス権は、取り込み処理とツールの読み取りに必要な最小限とする（B6）
- **名前**: `lookup_invoice_issuer`
- **説明文（日本語）**: 適格請求書発行事業者の登録番号（T+13桁）から、国税庁インボイス公表サイトにおける公表事実（登録状態、登録年月日、取消・失効年月日、法人・その他の団体の場合は公表された名称と所在地（その他の団体の所在地は公表データにある場合のみ））を確認します。任意の基準日を指定してその時点での有効性も照会可能です。個人の場合は氏名・屋号を返却せず、税務上の控除判断は行いません。
- **説明文（英語）**: Look up registered invoice issuer status by T-number (T+13 digits) from NTA public records with optional reference date. Returns factual registration status only without tax advice.
- **アノテーション**:
  - `title`: "Lookup Registered Invoice Issuer by T-number"
  - `readOnlyHint`: `true`
    - **設定理由**: 公表データの参照のみを行い、外部状態の変更を行わないため。
  - `destructiveHint`: `false`
    - **設定理由**: 破壊的処理を行わないため。
  - `idempotentHint`: `true`
    - **設定理由**: 同一番号・同一基準日での問い合わせは、同一データ時点において同一の事実結果を返すため。
  - `openWorldHint`: `false`（ホスト版提出時。ローカル版は `true`）
    - **設定理由**: 自社DBに保持した公表データの写しを読むだけで、外部システムへの接続・投稿・公開を行わないため。
- **入力スキーマ**:
  ```json
  {
    "type": "object",
    "properties": {
      "registration_number": {
        "type": "string",
        "description": "Registered invoice issuer number (starts with 'T' followed by 13 digits, e.g., 'T1234567890123')",
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
        "description": "Registration status as of data_as_of. 'not_found' means there is no matching record in the public dataset as of data_as_of (this may occur shortly after registration before public reflection and does not establish that the entity is unregistered)."
      },
      "business_type": {
        "type": "string",
        "enum": ["corporation", "individual", "other", "unknown"],
        "description": "Classification of issuer. 'unknown' is used only when status is 'not_found'."
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
        "description": "Published name for corporations and other entities (e.g., unincorporated associations). Always null for individuals."
      },
      "location": {
        "type": ["string", "null"],
        "description": "Published location for corporations. For other entities, included only when present in the public dataset. Always null for individuals."
      },
      "was_registered_on_reference_date": {
        "type": ["boolean", "null"],
        "description": "Whether the issuer was registered on the specified reference_date (on or after registration_date, and before cancellation/expiration dates); null if reference_date was not specified"
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

- **既存の扱い**: 変更なし（説明文のみM7に沿って補足）
- **名前**: `validate_corporate_number`
- **説明文（日本語）**: 13桁の法人番号の形式およびモジュラス9（ウェイト1-2方式）によるチェックデジットをローカルで検証します（外部通信なし）。チェックデジットが正しくても、その法人が実在することは確認しません。
- **説明文（英語）**: Validate the 13-digit corporate number format and check digit using Modulus 9 without external network calls. Valid check digit does not guarantee the corporation's actual existence.
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

### 1.5 `normalize_company_name`

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

## 2. Promptsの扱い（3本、入力最小化後の姿）

OpenAI Apps Developer Guidelines のデータ最小化要件 [出典-B2] に沿うよう、プロンプトの入力項目から個人の連絡先を排除し、法人特定に必要な最小限の情報のみを受け取る仕様とします（M8）。

### 2.1 `company-master-record`（旧 `business-card-to-database` より改名）

- **変更内容**: 会社名から取引先マスタのレコードを作るプロンプトとし、「名刺」の語を説明文から外す。個人の氏名・役職・電話番号・メールアドレス等の個人情報（PII）を入力項目から除外する。
- **説明文**: 会社名から法人番号や公表情報を検索・照合し、社内データベース用の取引先企業マスタレコードを生成します。※個人の連絡先情報は入力しないでください。
- **引数（Arguments）**:
  - `company_name`: string（必須。対象の会社名・商号）
  - `location_hint`: string（任意。名寄せの絞り込みに用いる都道府県や市区町村）

### 2.2 `customer-master-dedup`

- **変更内容**: 既存の取引先マスタ名寄せ支援。入力項目を目的に必要な最小限に保つ。
- **説明文**: 既存の顧客・取引先マスタの社名・住所から、国税庁の公表法人情報と突合して正式名称・法人番号を特定し、名寄せ・表記ゆれの統一を支援します。※個人の連絡先情報は入力しないでください。
- **引数（Arguments）**:
  - `target_company_name`: string（必須。名寄せ対象の会社名）
  - `current_address`: string（任意。照合用の住所）

### 2.3 `sales-list-enrichment`

- **変更内容**: 営業先企業リストの法人番号・公表情報補完。1回あたりの検索規模と応答サイズを抑えるため、上限20社を明記する。
- **説明文**: 企業名のリストから法人番号・所在地・法人種別を一括検索し、企業リストを補完します（1回あたり最大20社）。※個人の連絡先情報は入力しないでください。
- **引数（Arguments）**:
  - `company_list_text`: string（必須。企業名一覧。1行に1社、最大20社）

---

## 3. UIリソースの扱い

リソースはUIリソースのみとする。

どのツールがどのUIリソースを返却するかを以下のように定めます。

| ツール名 | 返却するUIリソースURI | 内容 |
| :--- | :--- | :--- |
| `lookup_corporate_by_number` | `ui://corporate-card/mcp-app.html` | 法人の商号、法人番号、所在地、更新年月日等の詳細カード表示 |
| `search_corporate_by_name` | `ui://search-results/mcp-app.html` | 検索結果一覧（既定10件、最大20件）のリスト表示 |
| `lookup_invoice_issuer` | なし（構造化テキストのみ） | UI非対応クライアントでもテキストのみで用が足りる設計とする |
| `validate_corporate_number` | なし | 判定結果（真偽値）のみ |
| `normalize_company_name` | なし | 正規化後文字列のみ |

- **UI下部のクレジット表示**:
  - 実装指示書 v1 §4 の仮定数に従い、案(a) `UI_CREDIT = "提供：スグクル株式会社"`（リンクなし）を仮置きする。

---

## 3.1 共通の返し方（F3）

全ツール共通のレスポンス形式を定めます。

- **成功時**: 各ツールの出力スキーマに一致する `structuredContent` と、要約のテキスト1つを返します。公表データを返すツール（lookup_corporate_by_number、search_corporate_by_name、lookup_invoice_issuer）の要約には、data_as_of と出典表示を含めます。
- **失敗時**: `isError: true` とし、`structuredContent` は次の形にします。
  ```json
  {
    "error": {
      "code": "INVALID_INPUT",
      "message": "利用者が読める短い説明"
    }
  }
  ```
  `code` は第4節の5種類のいずれかとします。`message` にスタックトレース・SQL文・内部ファイルパスは含めません。

---

## 4. 共通のエラー（M9）

全ツール共通のエラーコードと意味を定めます。

| コード | 意味 |
| :--- | :--- |
| `INVALID_INPUT` | 入力が形式に合わない（桁数不足、正規表現不一致等） |
| `NOT_FOUND` | 該当なし（※`lookup_invoice_issuer` は `status: not_found` で返すため、このコードは使わない） |
| `DATA_UNAVAILABLE` | 公表データを読めない（DB接続エラー、データ未初期化等） |
| `RATE_LIMITED` | 利用の上限に達した（IPレート制限等） |
| `INTERNAL_ERROR` | 上記以外のサーバー内部エラー |

- **出力規律**:
  - エラーの文面に、内部のスタックトレース・SQL文・内部ファイルパスは含めない設計とする。

---

## 5. サーバーの説明文（instructions）（M9）

初期化時にモデル（クライアント）へ渡すサーバーの説明文を以下のように定めます。宣伝文・外部リンク・Draptへの言及は含めず、税務上の判断を行わない旨を明記します。

### 5.1 日本語説明文（Instructions）
> 本サーバーは、国税庁が公表する日本の法人番号および適格請求書発行事業者の公表情報を照会・検証する機能を提供します。
> 法人番号による基本情報の照会、商号による検索、チェックデジットの計算検証、およびインボイス登録番号の登録状態の確認が可能です。
> 本サーバーが提供する情報は公表データの客観的事実の確認に限られ、税理士法第2条に定める税務相談・仕入税額控除の可否等の税務上の判断は行いません。
> 個人の連絡先情報やプライバシーに関わるデータの入力は避けてください。
> 公表データの内容を回答に示すときは、データの時点（data_as_of）と出典表示を併せて示してください。
> 登録番号（T＋13桁）の確認には lookup_invoice_issuer を使ってください。
> lookup_invoice_issuer の not_found は、公表データに該当がないことを示すもので、登録されていないことを確定するものではありません。

### 5.2 英語説明文（Instructions）
> This server provides tools to look up and verify Japanese corporate numbers and registered invoice issuers published by the National Tax Agency of Japan.
> You can retrieve published basic corporate information by corporate number, search corporations by name, validate check digits, and confirm registration status of invoice issuer numbers.
> All returned data is limited to objective facts from public records; this service does not provide tax consultation or determine eligibility for consumption tax purchase credits under Japanese law.
> Please refrain from providing personal contact details or private personal information in queries.
> When presenting public data in a response, include the dataset date (data_as_of) and the attribution.
> Use lookup_invoice_issuer to check invoice registration numbers (T followed by 13 digits).
> A 'not_found' result from lookup_invoice_issuer means no matching record in the public dataset; it does not establish that the entity is unregistered.

---

## 6. 出力に必ず含める項目・含めない項目

### 6.1 必ず含める項目
1. **データの時点（`data_as_of`）**:
   - 参照した公表データの日付（"YYYY-MM-DD"形式）。
2. **出典表示（`attribution`）**:
   - `attribution` の値は、実行中のデータの取り方（ホスト版の自社DB保持データ、またはローカル版のWeb-API直接呼出）に応じて切り替わる設計とする（M4）。

| データ | ホスト版（ダウンロードデータ） | ローカル版（Web-API） |
| :--- | :--- | :--- |
| 法人番号 | 「出典：国税庁法人番号公表サイト（国税庁）（ダウンロードページのURL）。同サイトの公表データをもとにスグクル株式会社が加工して作成」。ダウンロードページのURLはB4で確定する（要確認）（出典-A8） | 法人番号システムWeb-API機能利用規約 第6条（出典-A1） |
| インボイス | 「出典：国税庁適格請求書発行事業者公表サイト（国税庁）（https://www.invoice-kohyo.nta.go.jp/download/index.html）。同サイトの公表データをもとにスグクル株式会社が加工して作成」（出典-A7） | 適格請求書発行事業者公表システムWeb-API機能利用規約 第6条（出典-A3） |

※ホスト版において公表データを加工して利用する場合、国税庁が作成したかのような表示を行わない設計とします（出典-A7, 出典-A8）。

### 6.2 含めない項目
1. **リクエストID（`requestId`）** / **トレースID（`traceId`）**:
   - 応答サイズ最小化および内部情報の露出防止のため除外する。
2. **内部タイムスタンプ（`internal_timestamp`, `processed_at` 等）**:
   - データの時点（`data_as_of`）のみを残し、内部処理時刻は除外する。
3. **税務上の判断**:
   - 「仕入税額控除の対象となる/ならない」「控除可能額」「適用税率」など、税理士法第2条第1項第3号および第52条に抵触する恐れのある課税関係の判断や指導・助言 [出典-A6] は出力に含めない設計とする。

---

## 7. 出典一覧

- **[出典-A1]**: 国税庁 法人番号システムWeb-API機能利用規約（令和8年9月24日施行）第6条
- **[出典-A3]**: 国税庁 適格請求書発行事業者公表システムWeb-API機能利用規約（令和8年9月21日施行）第6条
- **[出典-A5]**: 国税庁 公表情報ダウンロード リソース定義書（個人事業者項目の非公表仕様）
- **[出典-A6]**: e-Gov法令検索 税理士法（昭和二十六年法律第二百三十七号）第2条、第52条
- **[出典-A7]**: 国税庁 適格請求書発行事業者公表サイト 利用規約（https://www.invoice-kohyo.nta.go.jp/terms-of-use.html 、公共データ利用規約（第1.0版）準拠、2026-10-12確認）
- **[出典-A8]**: 国税庁 法人番号公表サイト利用規約（令和7年2月28日改正 新旧対照表 https://www.houjin-bangou.nta.go.jp/sp/oshirase/r07/images/20250228_shinkyu_kohyo_riyokiyaku.pdf 、公共データ利用規約（第1.0版）準拠、2026-10-12確認。※現行の利用規約ページの文言が新旧対照表の改正後と同じかは、B4着手時に確認する）
- **[出典-B2]**: OpenAI Developers Apps SDK Developer Guidelines（データ最小化要件）

---

## 8. v1.1の変更点

2026-10-12のB0修正指示に基づき、以下の変更を反映しました。

- **M1（`validate_invoice_number` の削除）**:
  - 個人事業者の登録番号チェックデジット計算規則の一次資料が未確認であるため、保留とせず旧1.7節を削除しました。`lookup_invoice_issuer` の入力検証は形式照合（`^T[0-9]{13}$`）のみとします。
- **M2（`lookup_corporate_by_number` からの `invoice_status` 削除）**:
  - 凍結仕様における条件付き項目の排除のため、出力スキーマから `invoice_status` を削除し、インボイス確認は `lookup_invoice_issuer` に一本化しました。
- **M3（インボイス機能の全採用・全除外方針の明記）**:
  - B4ゲート（ダウンロードデータ利用条件確認）を通過しない場合は `lookup_invoice_issuer` を提出版から削除する方針を1.3節冒頭に明記し、第7節の出典一覧に「要確認（B4で確認）」を追加しました。
- **M4（出典表示根拠の分離）**:
  - 第6.1節の出典表示をホスト版とローカル版の2軸の表に置き換え、未確認箇所を「要確認（B4で確認）」と明記しました。データの取り方に応じて `attribution` 文言が切り替わる旨を明記しました。
- **M5（`openWorldHint` の動作適合）**:
  - 自社DBを参照するホスト版では `false`、Web-APIに接続するローカル版では `true` と定義し、提出用にはホスト版の理由を適用する表を第1節冒頭に追加しました。
- **M6（`lookup_invoice_issuer` 状態仕様の明確化）**:
  - `status` は常に `data_as_of` 時点の状態とし、`is_active_on_reference_date` を `was_registered_on_reference_date` に改名しました。`not_found` の定義を明確化し、入力例を形式例（`T1234567890123`）に変更しました。
- **M7（説明文の過大表現の修正）**:
  - `lookup_corporate_by_number` の説明文から「最新」「登記」の語を改め、事実（基本3情報・法人種別・更新日・データ時点）の記述に変更しました。`validate_corporate_number` に実在確認は行わない旨を追加しました。
- **M8（Promptsの個人情報非誘引化）**:
  - `business-card-to-database` を `company-master-record` に改名し「名刺」の語を除外しました。`sales-list-enrichment` に最大20社の明記を行いました。
- **M9（共通エラーおよびサーバー説明文の追加）**:
  - 第4節「共通のエラー」（5コード定義、内部トレース非開示）および第5節「サーバーの説明文（instructions）」（日・英各3〜5文、宣伝・外部リンク・Drapt言及なし、税務判断非提供明記）を新設しました。
- **O1（`get_attribution` の削除）**:
  - 全ツール出力に `attribution` が含まれることによる重複排除のため、旧1.5節 `get_attribution` を削除しました。
- **O2（`TAX_ACCOUNTANT_REVIEW_STATUS` のコードからの削除）**:
  - 製品設定値ではなく作業進捗であるため、`src/config/product.ts` から削除しました。

---

## 9. v1.2の変更点

2026-10-12のB0追加修正指示（v1.2）に基づき、一次資料確認結果（国税庁適格請求書発行事業者公表サイト利用規約）を反映しました。

- **1. インボイスダウンロードデータ利用条件の反映**:
  - インボイス公表サイト利用規約（https://www.invoice-kohyo.nta.go.jp/terms-of-use.html ）により公共データ利用規約（第1.0版）準拠で利用可能であることを確認済みとし、第1.3節および第7節 [出典-A7] に反映しました。
- **2. 個人事業者の登録番号に関する個人情報保護制約の追加**:
  - 同サイト利用規約上、個人事業者の登録番号が個人情報として扱われることに基づき、第1.3節に「完全一致照合のみ」「一覧・範囲・一括出力の不保持」「入力された番号のログ非記録」の3設計制約を追加しました。
- **3. 出典表示文言の確定（ホスト版インボイス）**:
  - 第6.1節の表において、ホスト版インボイスの出典表示を「国税庁適格請求書発行事業者公表サイト（国税庁）（当該ページのURL）をもとにスグクル株式会社作成」と確定させ、国が作成したかのような表示を行わない旨を明記しました。
- **4. 出典一覧の要確認の整理**:
  - 第7節の出典一覧に [出典-A7] を追加し、インボイス分を要確認から外しました。法人番号全件ダウンロードデータの出典文言は引き続き「要確認（B4で確認）」として残しました。

---

## 10. v1.3の変更点

2026-10-12のB0最終修正指示（v1.3）に基づき、一次資料確認結果（国税庁法人番号公表サイト利用規約 令和7年2月28日改正 新旧対照表）を反映しました。

- **1. 法人番号ダウンロードデータ利用条件の確定と出典表示の整理**:
  - 第6.1節の表において、ホスト版法人番号の出典表示を「国税庁法人番号公表サイト（国税庁）（当該ページのURL）を加工して作成」と確定させ、国が作成したかのような表示を行わない共通注記を付与しました。
- **2. 出典一覧の要確認の解除**:
  - 第7節の出典一覧に [出典-A8] を追加し、要確認を解除しました。現行Webページの文言突合はB4着手時に実施します。
- **3. ステータスの更新**:
  - ステータスを「v1.3（確認待ち）」へ更新しました。壁代表の承認後に「承認済み・凍結」へ更新します。

---

## 11. v1.4の変更点

2026-10-12のB0凍結前修正指示（v1.4）に基づき、構造上の課題（F1〜F6）および文言（T1〜T3）の修正を反映しました。

- **F1（`lookup_corporate_by_number` の閉鎖法人対応）**:
  - `corporation.status` を `["active", "closed"]` の列挙型に変更し、閉鎖日 `close_date` および閉鎖事由 `close_cause` を追加しました。
- **F2（`search_corporate_by_name` 各件の状態追加）**:
  - `results.items` に `status`（`["active", "closed"]`）を追加し、required に設定しました。
- **F3（共通の返し方の制定）**:
  - 新たに「共通の返し方」の節を設け、成功時（`structuredContent` と要約テキスト）および失敗時（`isError: true` とエラーオブジェクト）の返却形式を統一しました。
- **F4（`lookup_invoice_issuer` の人格のない社団等対応）**:
  - `corporate_name`、`location`、`business_type` の英語説明文を修正し、法人・個人以外の団体（人格のない社団等）の扱いおよび `unknown` の条件を明記しました。
- **F5（出典表示文言の修正）**:
  - 公表サイト利用規約に基づき、出典の記載と加工した旨の記載の双方を含む文言へ改め、インボイスダウンロードページのURLを反映しました。法人番号ダウンロードページのURLはB4で定めます。
- **F6（個人事業者の登録番号保持に伴う安全管理措置の明記）**:
  - ホスト版で自社DBに保持する個人事業者の登録番号の保護のため、プライバシーポリシーでの利用目的公表（B8）、IP単位のレート制限（B6）、DBアクセス権の最小化（B6）を設計制約に追加しました。
- **T1（「登記」「Registry」「official」の修正）**:
  - 1.1 の `title`、2.1 / 2.3 の説明文、UIリソース表、サーバー英語説明文に残っていた登記・公的誤認表現を修正しました。
- **T2（`lookup_corporate_by_number` 説明文への入力記載）**:
  - 日本語・英語の説明文に入力パラメータ（13桁の法人番号）を明記しました。
- **T3（サーバー説明文への指示追加）**:
  - 日・英のサーバー説明文の末尾に、データの時点・出典表示の回答への含有指示、インボイス照会ツールの指定、`not_found` の解釈を追記しました。

### 後続バッチで決めること
- B2：カーソルは `data_as_of` に結び付ける。データが更新された後の古いカーソルは `INVALID_INPUT` で返し、再検索を促す
- B4：名前検索の一致方式（前方一致・部分一致など）を決め、`search_corporate_by_name` の説明文に書く
- B5：`tax_disclaimer` の文言を決める。提出前に顧問税理士が確認する
- 凍結時の修正：3.1節の対象ツールの明確化、1.3節の日本語説明文をF4に合わせた

---

## 12. v1.5の変更点

2026-10-12のリソース整理指示（壁代表決定）に基づき、以下の変更を行いました。

- **リソースの整理**:
  - `attribution://houjin-bangou`（静的リソース）および `corp://{corporate_number}`（リソーステンプレート）の登録を解除し、リソースはUIリソース（`ui://...`）のみとしました。



