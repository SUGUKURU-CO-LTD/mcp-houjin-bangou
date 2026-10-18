# API Reference

本 MCP サーバー（v1.0.0 / 凍結仕様 v1.7）が提供する **5 Tools + 3 Prompts + 2 UI Resources + Completion** のリファレンスです。

---

## Tools（全5ツール）

すべてのツールには以下の MCP Tool Annotations が設定されています：
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

### 1. `lookup_corporate_by_number`

**目的**: 13桁の法人番号（1件）から法人基本情報および適格請求書発行事業者（インボイス）登録ステータスを取得します。

**UI リソース連携**: `_meta.ui.resourceUri = "ui://corporate-card/mcp-app.html"`

**Input**:

```typescript
{
  corporate_number: string;         // 13桁の法人番号（全角・ハイフン・空白混在可、自動正規化）
  include_invoice_status?: boolean; // 既定 true。インボイス登録状況（T+法人番号）も併せて照会
}
```

**Output (`structuredContent`)**:

```typescript
{
  found: boolean;
  corporate_number: string;         // 正規化後の半角13桁数字
  data_as_of: string;               // YYYY-MM-DD（公表データ基準日）
  record: {
    corporate_number: string;
    name: string;
    furigana: string | null;
    en_name: string | null;
    kind_name: string;
    address: {
      prefecture_code: string;
      city_code: string;
      post_code: string | null;
      prefecture_name: string;
      city_name: string;
      street_number: string;
      full: string;
    };
    status: 'active' | 'closed' | 'absorbed';
    assignment_date: string;
    close_date: string | null;
    close_cause: string | null;
    successor_corporate_number: string | null;
  } | null;
  invoice_issuer: {
    registration_number: string;    // "T" + 13桁
    is_registered: boolean;
    registration_date: string | null;
    update_date: string | null;
    revoke_date: string | null;
    expire_date: string | null;
  } | null;
  attribution: Attribution;
}
```

**エラー**:
- チェックデジット不一致・桁数不正 → `isError: true`（外部 API や DB にはアクセスしない）

---

### 2. `search_corporate_by_name`

**目的**: 法人名（商号又は名称）で法人を検索します。入力された会社名は自動的に表記揺れ正規化（T7）され、都道府県・市区町村・閉鎖法人フィルタおよびカーソルページングに対応します。

**UI リソース連携**: `_meta.ui.resourceUri = "ui://search-results/mcp-app.html"`

**Input**:

```typescript
{
  query: string;                    // 検索する会社名（1〜150文字）
  prefecture_code?: string;         // JIS X 0401 都道府県コード ("01"〜"47")
  city_name?: string;               // 市区町村名（例: "霧島市", "千代田区"）
  include_closed?: boolean;         // 既定 false。登記閉鎖法人も含めるか
  limit?: number;                   // 既定 10（1〜50）
  cursor?: string;                  // 前回レスポンスの next_cursor
}
```

**Output (`structuredContent`)**:

```typescript
{
  query: string;
  normalized_queries_tried: string[];
  total_count: number;
  returned_count: number;
  next_cursor: string | null;
  data_as_of: string;               // YYYY-MM-DD
  results: Array<{
    corporate_number: string;
    name: string;
    furigana: string | null;
    kind_name: string;
    prefecture_name: string;
    city_name: string;
    full_address: string;
    status: 'active' | 'closed' | 'absorbed';
    close_date: string | null;
    successor_corporate_number: string | null;
  }>;
  attribution: Attribution;
}
```

**カーソル整合性検証**:
- `cursor` には `data_as_of`（データ基準日）がエンコードされており、月次データ更新を挟んで基準日が変わった古いカーソルを渡した場合は、先頭ページからの再検索を促すエラー（`isError: true`）を返します。

---

### 3. `lookup_invoice_issuer`

**目的**: 適格請求書発行事業者の登録番号（`T` + 13桁数字、または13桁数字）を照会し、登録の有無・人格区分・全登録期間履歴（`registration_periods`）および取引基準日（`reference_date`）時点での登録有効期間照合結果（`valid_on_reference_date`）を返します。

**UI リソース連携**: `_meta.ui.resourceUri = "ui://corporate-card/mcp-app.html"`

**Input**:

```typescript
{
  registration_number: string;      // T+13桁（または13桁数字。全角・小文字t・ハイフン自動正規化）
  reference_date?: string;          // 取引基準日 YYYY-MM-DD（実在する暦日のみ受付）
}
```

**Output (`structuredContent`)**:

```typescript
{
  registration_number: string;      // "T" + 13桁
  is_registered: boolean;
  legal_entity_type: 'corporation' | 'sole_proprietor' | 'unincorporated_association' | null;
  name: string | null;              // 法人の場合のみ（個人事業者は常に null）
  address: string | null;           // 法人の場合のみ（個人事業者は常に null）
  registration_date: string | null;
  update_date: string | null;
  revoke_date: string | null;
  expire_date: string | null;
  registration_periods: Array<{
    registration_date: string;
    revoke_date: string | null;
    expire_date: string | null;
  }>;
  reference_date: string | null;
  valid_on_reference_date: boolean | null;
  data_as_of: string;
  attribution: Attribution;
}
```

**仕様上の重要ルール**:
- `reference_date` 未指定時、または公表データに該当番号が存在しない場合、`valid_on_reference_date` は `null` になります。
- 再登録等で同一登録番号に複数の登録期間がある場合、いずれかの期間で `registration_date <= reference_date` かつ `min(revoke_date, expire_date)`（存在する場合）`>= reference_date` を満たせば `valid_on_reference_date: true` となります。
- 個人事業者（`sole_proprietor`）については、氏名・屋号・所在地をデータベースに保持せず、常に `name: null`, `address: null` を返します。

---

### 4. `validate_corporate_number`

**目的**: 法人番号（13桁）のチェックデジット（モジュロ9、国税庁仕様書 第二編 §2.1.3）をローカルで検証します。外部通信や DB クエリは一切行いません。

**Input**:

```typescript
{
  corporate_number: string;         // ハイフン・全角数字・空白・先頭T混在可
}
```

**Output (`structuredContent`)**:

```typescript
{
  raw_input: string;
  normalized_number: string | null; // 半角13桁数字（正規化不能時は null）
  is_valid: boolean;
  check_digit: number | null;       // 先頭1桁の検査用数字 (1〜9)
  expected_check_digit: number | null;
  reason: 'ok' | 'not_13_digits' | 'check_digit_mismatch' | 'invalid_characters' | 'first_digit_zero';
}
```

---

### 5. `normalize_company_name`

**目的**: 会社名の表記揺れ（7パターン）を正規化し、検索候補リストを生成します。外部通信や DB クエリは一切行いません。

**Input**:

```typescript
{
  raw_input: string;                // 1〜500文字
}
```

**Output (`structuredContent`)**:

```typescript
{
  raw_input: string;
  extracted_core_name: string;
  candidates: Array<{
    name: string;
    kind_hint: string;
    prefix_or_suffix: 'mae_kabu' | 'ato_kabu' | 'none';
    confidence: number;             // 0.0〜1.0
    applied_rules: string[];
  }>;
}
```

---

## Prompts（全3種）

| Prompt 名 | 用途 | 引数 |
|---|---|---|
| `company-master-record` | 会社名（および任意の住所ヒント）から表記揺れ正規化→法人検索を行い、取引先マスタ登録用データを整形（個人連絡先は扱わない） | `company_name` (必須), `address_hint` (任意) |
| `sales-list-enrichment` | 複数の会社名リストに対して法人番号・正式商号・本店所在地を付与 | `company_names` (必須), `output_format` (任意: `markdown_table` / `json` / `csv`) |
| `customer-master-dedup` | 顧客マスタ内の表記揺れ・移転・合併による重複候補を検出 | `records_jsonl` (必須), `dedup_criteria` (任意) |

---

## UI Resources（全2種）

| URI | 名称 | 対応ツール |
|---|---|---|
| `ui://corporate-card/mcp-app.html` | Corporate Card UI | `lookup_corporate_by_number`, `lookup_invoice_issuer` |
| `ui://search-results/mcp-app.html` | Search Results UI | `search_corporate_by_name` |

---

## Completion

- `completion/complete` は `ref/prompt` の会社名引数（`company_name`, `target_company_name`, `name`, `raw_input`）に対して `normalizeCompanyName` による表記揺れ展開候補（最大20件）を返します。

---

## Shared Types

### `Attribution`

```typescript
{
  source_name: string;
  source_url: string;
  disclaimer: string;
  license: string;
  api_version: string;
  data_as_of: string;
}
```
