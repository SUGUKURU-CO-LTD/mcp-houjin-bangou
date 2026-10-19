# API Reference

本 MCP サーバー（v1.0.0 / 仕様 v1.8）が提供する **5 Tools + 3 Prompts + 2 UI Resources + Completion + Environment Variables** のリファレンスです。
すべての定義値・型・引数・戻り値は `src/` の実装コードから直接転記されています。

---

## Tools（全5ツール）

### MCP Tool Annotations

| ツール名 | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `lookup_corporate_by_number` | `true` | `false` | `true` | `true` |
| `search_corporate_by_name` | `true` | `false` | `true` | `true` |
| `lookup_invoice_issuer` | `true` | `false` | `true` | `true` |
| `validate_corporate_number` | `true` | `false` | `true` | `false` |
| `normalize_company_name` | `true` | `false` | `true` | `false` |

※ 公開実体エンティティを照会するツール3種は仕様 v1.8 によりホスト版・ローカル版共通で `openWorldHint: true` です。外部通信を行わないローカル計算ツール2種は `openWorldHint: false` です。

---

### 1. `lookup_corporate_by_number`

- **ソースコード定義**: [`src/tools/lookup-by-number.ts`](file:///Users/kabe/houjin-wt-secret/src/tools/lookup-by-number.ts#L27-L66)
- **目的**: 13桁の法人番号を指定して、国税庁が公表している法人の基本情報（名称・所在地・法人番号・法人種別・更新年月日・閉鎖の有無等）を取得します。
- **UI リソース連携**: `_meta.ui.resourceUri = "ui://corporate-card/mcp-app.html"`

#### Input Schema
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
    close_date: string | null;            // Date of closure (YYYY-MM-DD); null if active
    close_cause: string | null;           // Reason for closure (e.g., liquidation, merger); null if active
    address_may_be_outdated?: boolean;   // True if registered address may differ from current address
  };
  data_as_of: string;                     // Date of the public dataset (YYYY-MM-DD)
  attribution: string;                    // Attribution text required by NTA terms of service
}
```

---

### 2. `search_corporate_by_name`

- **ソースコード定義**: [`src/tools/search-by-name.ts`](file:///Users/kabe/houjin-wt-secret/src/tools/search-by-name.ts#L30-L88)
- **目的**: 法人名を指定して、前方一致・部分一致で法人一覧を検索します。都道府県コードによる絞り込みやカーソルページネーションに対応します。
- **UI リソース連携**: `_meta.ui.resourceUri = "ui://search-results/mcp-app.html"`

#### Input Schema
```typescript
{
  name: string;         // Corporate name to search (kanji, kana, or romaji, 1-100 characters)
  prefecture?: string;  // Optional 2-digit prefecture code (01-47, regex: /^(0[1-9]|[1-3][0-9]|4[0-7])$/)
  cursor?: string;      // Opaque cursor for pagination returned from previous search
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
  total_count: number | null; // Total number of matched corporations if known
  next_cursor: string | null; // Cursor token for fetching next page; null if no more items
  data_as_of: string;         // Date of the public dataset (YYYY-MM-DD)
  attribution: string;        // Attribution text required by NTA terms of service
}
```

---

### 3. `lookup_invoice_issuer`

- **ソースコード定義**: [`src/tools/lookup-invoice-issuer.ts`](file:///Users/kabe/houjin-wt-secret/src/tools/lookup-invoice-issuer.ts#L26-L71)
- **目的**: 適格請求書発行事業者の登録番号（T+13桁）から、国税庁インボイス公表サイトにおける公表事実（登録状態、登録年月日、取消・失効年月日、法人・その他の団体の場合は公表された名称と所在地）を確認します。任意の基準日を指定してその時点での有効性も照会可能です。個人の場合は氏名・屋号を返却せず、税務上の控除判断は行いません。

#### Input Schema
```typescript
{
  registration_number: string; // Registered invoice issuer number (starts with 'T' followed by 13 digits, regex: /^T[0-9]{13}$/)
  reference_date?: string;     // Optional reference date in 'YYYY-MM-DD' format (regex: /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/)
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
  corporate_name: string | null;
  location: string | null;
  was_registered_on_reference_date: boolean | null;
  data_as_of: string;
  attribution: string;
  tax_disclaimer: string;
}
```

---

### 4. `validate_corporate_number`

- **ソースコード定義**: [`src/tools/validate-check-digit.ts`](file:///Users/kabe/houjin-wt-secret/src/tools/validate-check-digit.ts#L16-L31)
- **目的**: 13桁の法人番号の形式およびモジュラス9（ウェイト1-2方式）によるチェックデジットをローカルで検証します（外部通信なし）。チェックデジットが正しくても、その法人が実在することは確認しません。

#### Input Schema
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

- **ソースコード定義**: [`src/tools/normalize-company-name.ts`](file:///Users/kabe/houjin-wt-secret/src/tools/normalize-company-name.ts#L16-L32)
- **目的**: 企業名の表記ゆれ（全角・半角英数字、(株)や株式会社の表記位置、特殊記号、スペース等）を正規化します（ローカル処理）。

#### Input Schema
```typescript
{
  raw_name: string; // Raw company name string to normalize (1-200 characters)
}
```

#### Output Schema (`structuredContent`)
```typescript
{
  normalized_name: string;        // 正規化された企業名
  legal_type: string | null;      // 検出された法人種別（未検出の場合は null）
  search_query_optimized: string; // 検索用に最適化されたコア企業名
}
```

---

## Prompts（全3種）

### 1. `company-master-record`
- **ソースコード定義**: [`src/prompts/company-master-record.ts`](file:///Users/kabe/houjin-wt-secret/src/prompts/company-master-record.ts#L16-L35)
- **説明**: 会社名から法人番号や公表情報を検索・照合し、社内データベース用の取引先企業マスタレコードを生成します。※個人の連絡先情報は入力しないでください。
- **引数**:
  - `company_name`: string (1-500文字, 必須) — 対象の会社名・商号
  - `location_hint`?: string (最大200文字, 任意) — 名寄せの絞り込みに用いる都道府県や市区町村

### 2. `sales-list-enrichment`
- **ソースコード定義**: [`src/prompts/sales-list-enrichment.ts`](file:///Users/kabe/houjin-wt-secret/src/prompts/sales-list-enrichment.ts#L24-L32)
- **説明**: 企業名のリストから法人番号・所在地・法人種別を一括検索し、企業リストを補完します（1回あたり最大20社）。※個人の連絡先情報は入力しないでください。
- **引数**:
  - `company_list_text`: string (必須, 1行に1社、最大20社) — 企業名一覧

### 3. `customer-master-dedup`
- **ソースコード定義**: [`src/prompts/customer-master-dedup.ts`](file:///Users/kabe/houjin-wt-secret/src/prompts/customer-master-dedup.ts#L16-L37)
- **説明**: 既存の顧客・取引先マスタの社名・住所から、国税庁の公表法人情報と突合して正式名称・法人番号を特定し、名寄せ・表記ゆれの統一を支援します。※個人の連絡先情報は入力しないでください。
- **引数**:
  - `target_company_name`: string (1-500文字, 必須) — 名寄せ対象の会社名
  - `current_address`?: string (最大300文字, 任意) — 照合用の住所

---

## UI Resources（全2種）

- **ソースコード定義**: [`src/resources/ui-resources.ts`](file:///Users/kabe/houjin-wt-secret/src/resources/ui-resources.ts#L13-L26)

| URI | 名称 | 概要 |
|---|---|---|
| `ui://corporate-card/mcp-app.html` | Corporate Card UI | 法人番号検索結果を単一カードとして表示する UI Resource |
| `ui://search-results/mcp-app.html` | Search Results UI | 法人名検索結果を一覧表として表示する UI Resource |

---

## Completion

- **ソースコード定義**: [`src/completion/handler.ts`](file:///Users/kabe/houjin-wt-secret/src/completion/handler.ts#L54-L87)
- `ref/prompt` において、以下の引数名に対して `normalizeCompanyName` による表記揺れ展開候補（最大20件）を補完します：
  - `company_name`
  - `target_company_name`
  - `name`
  - `raw_input`

---

## Environment Variables（環境変数）

- **ソースコード定義**: [`src/lib/env.ts`](file:///Users/kabe/houjin-wt-secret/src/lib/env.ts#L10-L75)

| 環境変数名 | 型 / 許容値 | 既定値 | 説明 |
|---|---|---|---|
| `DATA_SOURCE` | `'web-api' \| 'db'` | `'web-api'` | 動作データソースモード |
| `DATABASE_URL` | string | なし | PostgreSQL 接続文字列（`DATA_SOURCE=db` 時に必須） |
| `NTA_APPLICATION_ID` | string | なし | 国税庁 Web-API アプリケーション ID（`DATA_SOURCE=web-api` 時に必須） |
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
