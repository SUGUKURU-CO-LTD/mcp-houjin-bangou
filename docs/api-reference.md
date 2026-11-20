# API Reference

本 MCP サーバー（`@sugukuru/mcp-houjin-bangou` v1.1.0+）が提供する **5 Tools + 3 Prompts + 2 MCP Apps UI Resources + Completion + Error Contract + Environment Variables** のリファレンスです。
すべての定義値・型・引数・戻り値は `src/` の実装コードに対応しています。

---

## Tools（全5ツール）

すべてのツールの `inputSchema` は `.strict()`（`"additionalProperties": false`）であり、未定義の余剰プロパティは拒否されます。

### MCP Tool Annotations & Operating Mode Support

| ツール名 | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | `DATA_SOURCE=db` (ホスト版) | `DATA_SOURCE=web-api` (ローカル版) |
|---|---|---|---|---|---|---|
| `lookup_corporate_by_number` | `true` | `false` | `true` | `true` | 対応 | 対応 |
| `search_corporate_by_name` | `true` | `false` | `true` | `true` | 対応（半角/全角 ASCII 両対応） | 対応（前方一致） |
| `lookup_invoice_issuer` | `true` | `false` | `true` | `true` | 対応 | 非対応（`DATA_UNAVAILABLE`） |
| `validate_corporate_number` | `true` | `false` | `true` | `false` | 対応（ローカル計算） | 対応（ローカル計算） |
| `normalize_company_name` | `true` | `false` | `true` | `false` | 対応（ローカル計算） | 対応（ローカル計算） |

※ 公開実体エンティティを照会するツール3種は仕様 v1.8+ によりホスト版・ローカル版共通で `openWorldHint: true` です。外部通信を行わないローカル計算ツール2種は `openWorldHint: false` です。

---

### 1. `lookup_corporate_by_number`

- **ソースコード定義**: [`src/tools/lookup-by-number.ts`](../src/tools/lookup-by-number.ts)
- **目的**: 13桁の法人番号を指定して、国税庁が公表している法人の基本情報（名称・フリガナ・所在地・郵便番号・法人番号・法人種別・更新年月日・閉鎖の有無と事由・承継先法人番号等）を取得します。
- **UI リソース連携**: `_meta.ui.resourceUri = "ui://corporate-card/mcp-app.html"`

#### Input Schema (`additionalProperties: false`)
```typescript
{
  corporate_number: string; // 13-digit Japanese national corporate number (digits only, e.g., '9340001026142', regex: /^[0-9]{13}$/)
}
```

#### Output Schema (`structuredContent`)
```typescript
{
  corporation: {
    corporate_number: string;
    name: string;
    name_kana: string | null;
    legal_type: string;
    location: string;
    post_code: string | null;
    update_date: string;
    status: 'active' | 'closed';
    close_date: string | null;                   // Date of closure (YYYY-MM-DD); null if active
    close_cause: string | null;                  // Reason for closure (e.g., liquidation, merger); null if active
    successor_corporate_number?: string | null;  // 13-digit corporate number of successor entity (e.g., after merger); null if none
    address_may_be_outdated?: boolean;           // True if registered address may differ from current address (from NTA hihyoji flag)
  };
  data_as_of: string;                            // Date of the public dataset (YYYY-MM-DD)
  attribution: string;                           // Attribution text required by NTA terms of service
}
```

---

### 2. `search_corporate_by_name`

- **ソースコード定義**: [`src/tools/search-by-name.ts`](../src/tools/search-by-name.ts)
- **目的**: 法人名を指定して法人一覧を検索します。ホスト版（`DATA_SOURCE=db`）では1〜2文字は前方一致・3文字以上は部分一致（かつ半角/全角 ASCII 英数字の双方に一致）、ローカル Web-API 版（`DATA_SOURCE=web-api`）では国税庁 Web-API の前方一致検索を行います。略称（`(株)` 等）や旧字体を含む会社名を検索する際は、先に `normalize_company_name` を呼び出して正規化してください。
- **UI リソース連携**: `_meta.ui.resourceUri = "ui://search-results/mcp-app.html"`

#### Input Schema (`additionalProperties: false`)
```typescript
{
  name: string;         // Corporate name to search (kanji, kana, or romaji, 1-100 characters)
  prefecture?: string;  // Optional 2-digit JIS X 0401 prefecture code (01-47, regex: /^(0[1-9]|[1-3][0-9]|4[0-7])$/)
  cursor?: string;      // Opaque cursor bound to queryKey and data_as_of from previous search
  limit?: number;       // Number of results to return (default: 10, min: 1, max: 20)
}
```

#### Output Schema (`structuredContent`)
```typescript
{
  results: Array<{
    corporate_number: string;
    name: string;
    legal_type: string;
    location: string;
    update_date: string;
    status: 'active' | 'closed';
    address_may_be_outdated?: boolean;
  }>;
  total_count: number | null; // Total number of matched corporations if known (null when further pages exist in DB mode)
  next_cursor: string | null; // Cursor token for fetching next page; null if no more items
  data_as_of: string;         // Date of the public dataset (YYYY-MM-DD)
  attribution: string;        // Attribution text required by NTA terms of service
}
```

---

### 3. `lookup_invoice_issuer`

- **ソースコード定義**: [`src/tools/lookup-invoice-issuer.ts`](../src/tools/lookup-invoice-issuer.ts)
- **目的**: 適格請求書発行事業者の登録番号（`T`+13桁）から、国税庁インボイス公表サイトにおける公表事実（登録状態、登録年月日、取消・失効年月日、法人・その他の団体の場合は公表された名称と所在地）を確認します。任意の基準日（`reference_date`）を指定してその時点での有効性も照会可能です。個人事業者の場合は氏名・屋号・所在地を一切保持・返却せず、税務上の控除判断は行いません。利用者が示した登録番号を1件ずつ確かめるためのツールであり、番号の範囲を順に照会して一覧を作る用途には使えません。
- **動作モード要件**: ホスト版（`https://houjin.mcp.sugu-kuru.co.jp/mcp`）またはローカル PostgreSQL モード（`DATA_SOURCE=db`）でのみ利用可能です。`DATA_SOURCE=web-api` モードでは `DATA_UNAVAILABLE` エラーを返します。
- **UI リソース連携**: `_meta.ui.resourceUri = "ui://corporate-card/mcp-app.html"`（インボイス登録確認カード表示および法人基本情報カードへの相互遷移に対応）

#### Input Schema (`additionalProperties: false`)
```typescript
{
  registration_number: string; // Registered invoice issuer number (starts with 'T' followed by 13 digits, regex: /^T[0-9]{13}$/)
  reference_date?: string;     // Optional real calendar date in 'YYYY-MM-DD' format (e.g., '2026-10-01'; invalid dates such as '2026-02-31' return INVALID_INPUT)
}
```

#### Output Schema (`structuredContent`)
```typescript
{
  registration_number: string;
  status: 'registered' | 'cancelled' | 'expired' | 'not_found';
  business_type: 'corporation' | 'individual' | 'other' | 'unknown';
  registration_date: string | null;
  cancellation_date: string | null;
  expiration_date: string | null;
  corporate_name: string | null;                    // Always null for individuals
  location: string | null;                          // Always null for individuals
  was_registered_on_reference_date: boolean | null; // Fact check as of data_as_of (includes horizon caveat in text summary if reference_date > data_as_of)
  data_as_of: string;
  attribution: string;
  tax_disclaimer: string;
}
```

---

### 4. `validate_corporate_number`

- **ソースコード定義**: [`src/tools/validate-check-digit.ts`](../src/tools/validate-check-digit.ts)
- **目的**: 13桁の法人番号の形式およびモジュラス9（ウェイト1-2方式）によるチェックデジットをローカルで検証します（外部通信なし）。チェックデジットが正しくても、その法人が実在することは確認しません。

#### Input Schema (`additionalProperties: false`)
```typescript
{
  corporate_number: string; // 13-digit corporate number string to validate (regex: /^[0-9]{13}$/)
}
```

#### Output Schema (`structuredContent`)
```typescript
{
  is_valid_format: boolean;
  is_valid_check_digit: boolean;
  error_reason: string | null;
}
```

---

### 5. `normalize_company_name`

- **ソースコード定義**: [`src/tools/normalize-company-name.ts`](../src/tools/normalize-company-name.ts)
- **目的**: 企業名の表記ゆれ（全角・半角英数字、`(株)` / `㈱` 等の略称展開・前後位置変換、各種法人種別の分離、英語表記、旧字体→新字体、異体字セレクタ、スペース等）を決定論的に正規化します（ローカル処理）。

#### Input Schema (`additionalProperties: false`)
```typescript
{
  raw_name: string; // Raw company name string to normalize (1-200 characters)
}
```

#### Output Schema (`structuredContent`)
```typescript
{
  normalized_name: string;        // 正規化された企業名（正式法人格へ展開）
  legal_type: string | null;      // 検出された法人種別（未検出の場合は null）
  search_query_optimized: string; // 検索用に最適化されたコア企業名
}
```

---

## Error Response Contract（共通エラー応答）

- **ソースコード定義**: [`src/lib/tool-response.ts`](../src/lib/tool-response.ts)
- ツール実行エラー時は `isError: true` を返します。MCP SDK クライアント側での `outputSchema` 検証クラッシュを防ぐため、`isError: true` の応答には `structuredContent` を含めず、以下の形式で返却します：

```typescript
{
  isError: true,
  content: [{ type: 'text', text: '[ERROR_CODE] 利用者向けの説明メッセージ' }],
  _meta: {
    error: {
      code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DATA_UNAVAILABLE' | 'RATE_LIMITED' | 'INTERNAL_ERROR',
      message: string
    }
  }
}
```

---

## Prompts（全3種）

### 1. `company-master-record`
- **ソースコード定義**: [`src/prompts/company-master-record.ts`](../src/prompts/company-master-record.ts)
- **説明**: 会社名から法人番号や公表情報を検索・照合し、社内データベース用の取引先企業マスタレコードを生成します。※個人の連絡先情報は入力しないでください。
- **引数**:
  - `company_name`: string (1-500文字, 必須) — 対象の会社名・商号
  - `location_hint`?: string (最大200文字, 任意) — 名寄せの絞り込みに用いる都道府県や市区町村

### 2. `sales-list-enrichment`
- **ソースコード定義**: [`src/prompts/sales-list-enrichment.ts`](../src/prompts/sales-list-enrichment.ts)
- **説明**: 企業名のリストから法人番号・所在地・法人種別を一括検索し、企業リストを補完します（1回あたり最大20社）。※個人の連絡先情報は入力しないでください。
- **引数**:
  - `company_list_text`: string (必須, 1行に1社、最大20社) — 企業名一覧

### 3. `customer-master-dedup`
- **ソースコード定義**: [`src/prompts/customer-master-dedup.ts`](../src/prompts/customer-master-dedup.ts)
- **説明**: 既存の顧客・取引先マスタの社名・住所から、国税庁の公表法人情報と突合して正式名称・法人番号を特定し、名寄せ・表記ゆれの統一を支援します。※個人の連絡先情報は入力しないでください。
- **引数**:
  - `target_company_name`: string (1-500文字, 必須) — 名寄せ対象の会社名
  - `current_address`?: string (最大300文字, 任意) — 照合用の住所

---

## MCP Apps UI Resources（全2種）

- **ソースコード定義**: [`src/resources/ui-resources.ts`](../src/resources/ui-resources.ts)

| URI | 名称 | 接続ツール | 概要 |
|---|---|---|---|
| `ui://corporate-card/mcp-app.html` | Corporate Card UI | `lookup_corporate_by_number`, `lookup_invoice_issuer` | 法人詳細カードおよびインボイス登録確認カードを表示するインタラクティブ UI（番号コピー、類似商号検索、承継先法人遷移、ワンクリック・インボイス照合、基準日再確認対応） |
| `ui://search-results/mcp-app.html` | Search Results UI | `search_corporate_by_name` | 法人名検索結果を一覧表示するインタラクティブ UI（状態フィルタ、`next_cursor` ページネーション、法人カードへのドリルダウンと履歴「戻る」対応） |

---

## Completion

- **ソースコード定義**: [`src/completion/handler.ts`](../src/completion/handler.ts)
- `ref/prompt` において、登録済みプロンプトの会社名・所在地引数（`company_name`, `target_company_name`, `location_hint`, `company_list_text` 等）に対して `normalizeCompanyName` や都道府県コード辞書による候補補完を返却します。

---

## Environment Variables（環境変数）

- **ソースコード定義**: [`src/lib/env.ts`](../src/lib/env.ts)

| 環境変数名 | 型 / 許容値 | 既定値 | 説明 |
|---|---|---|---|
| `DATA_SOURCE` | `'web-api' \| 'db'` | `'web-api'` | 動作データソースモード |
| `DATABASE_URL` | string | なし | PostgreSQL 接続文字列（`DATA_SOURCE=db` 時に必須） |
| `NTA_APPLICATION_ID` | string | なし | 国税庁 法人番号 Web-API アプリケーション ID（`DATA_SOURCE=web-api` 時に必須） |
| `NTA_BASE_URL` | string (URL) | `'https://api.houjin-bangou.nta.go.jp/4'` | 国税庁 Web-API ベース URL |
| `PORT` | number (正の整数) | `3001` | HTTP サーバー待受ポート番号 |
| `LOG_LEVEL` | `'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace'` | `'info'` | ログ出力レベル |
| `NODE_ENV` | `'development' \| 'test' \| 'production'` | `'development'` | 実行環境モード |
| `NTA_RATE_LIMIT_RPS` | number (正数) | `1` | 国税庁 Web-API への最大リクエスト数/秒 |
| `NTA_TIMEOUT_MS` | number (正の整数) | `8000` | 国税庁 Web-API へのリクエストタイムアウト（ミリ秒） |
| `ALLOWED_ORIGINS` | string | `''` | カンマ区切りの許可 Origin 一覧。Origin ヘッダーがある場合のみ照合し、不一致時は HTTP 403 |
| `TRUST_PROXY` | number (0以上の整数) | `1` | Express の trust proxy ホップ数（Cloud Run 前段 GFE 1段用） |
| `RATE_LIMIT_WINDOW_MS` | number (正の整数) | `60000` | IP 単位レート制限集計ウィンドウ（ミリ秒） |
| `RATE_LIMIT_MAX_REQUESTS` | number (正の整数) | `60` | 集計ウィンドウあたりの 1 IP 最大リクエスト数 |
| `OPENAI_APPS_CHALLENGE_TOKEN` | string | `''` | ChatGPT Apps ドメイン確認用チャレンジトークン。未設定時は 404 |
