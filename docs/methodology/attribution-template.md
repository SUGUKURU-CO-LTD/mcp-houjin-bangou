# Attribution Template — 対象 API 利用規約遵守の出典強制パターン

本プロジェクトでは、国税庁 Web-API 機能利用規約 別添1 第6条 の指定文言 +
公共データ利用規約 第1.0版 別添3 の出典要件 を、Zod schema で**構造的に強制**した。

この手法は他 API にも完全に再利用可能。

## 思想

API 利用規約の出典義務条項は、通常「サービス画面のどこかに書く」運用に任される。
しかし運用に任せると、開発者の意図次第で出典が抜け落ちる。

解決策: **全 Tool output で `attribution` フィールドを Zod required 化**。
これにより:

1. LLM が出典を user に伝えることが構造的に強制される
2. プロンプトインジェクション緩和（出所の透明性）にも寄与
3. Anthropic Directory Policy の "no misleading information" 要件に自然に合致

## 再利用テンプレート

### Zod Schema

```ts
import { z } from 'zod';

export const AttributionSchema = z.object({
  data_source: z
    .string()
    .describe('データ出典 / Data source (利用規約で指定された出典 URL)'),
  service_disclaimer: z
    .string()
    .describe('利用規約で要求される指定文言 / Required disclaimer text'),
  license: z
    .string()
    .describe('ライセンス / License (公共データ利用規約 第1.0版 等)'),
  api_version: z
    .string()
    .describe('API バージョン'),
  accessed_at: z
    .string()
    .describe('アクセス日時 (ISO 8601)'),
});

export type Attribution = z.infer<typeof AttributionSchema>;

export function buildAttribution(): Attribution {
  return {
    data_source:
      // 対象 API の利用規約で指定された正式な出典 URL + 名称
      '対象公表サイト（提供機関名）https://example.gov.jp/',
    service_disclaimer:
      // 対象 API 利用規約で指定された「一字一句変えずに使う」文言
      'このサービスは、XXX機能を利用して取得した情報をもとに作成しているが、サービスの内容はXXXによって保証されたものではない。',
    license:
      // 対象 API のデータライセンス (公共データ利用規約等)
      '公共データ利用規約 第1.0版',
    api_version: 'Ver.X.Y',
    accessed_at: new Date().toISOString(),
  };
}
```

### 全 Tool output schema への埋め込み

```ts
// 例: lookup-tool.ts
const OutputSchema = z.object({
  // ... tool 固有の field
  attribution: AttributionSchema,  // ← 必須化
}).strict();
```

### `get_attribution` Tool の同梱

Tool として独立して出典情報を返す API を同梱する:

```ts
server.registerTool('get_attribution', {
  title: 'Get required attribution text',
  description: '対象 API 利用規約遵守の指定文言を返す。...',
  inputSchema: z.object({
    format: z.enum(['full', 'short', 'citation']).default('full'),
    language: z.enum(['ja', 'en']).default('ja'),
  }).shape,
  // ...
}, async (args) => {
  const attribution = buildAttribution();
  const formatted = format === 'citation'
    ? `出典: ${attribution.data_source}`
    : [
        `出典: ${attribution.data_source}`,
        `免責: ${attribution.service_disclaimer}`,
        // ...
      ].join('\n');
  return { content: [{ type: 'text', text: formatted }] };
});
```

### 静的 Resource としての公開

```ts
server.registerResource(
  'attribution',
  'attribution://target-domain',
  {
    title: 'Attribution: XXX API',
    description: 'XXX 利用規約遵守の出典情報',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [{
      uri: 'attribution://target-domain',
      mimeType: 'application/json',
      text: JSON.stringify(buildAttribution(), null, 2),
    }],
  }),
);
```

### Server Card への埋め込み

```json
{
  "attribution": {
    "data_source": "対象公表サイト (https://example.gov.jp/)",
    "license": "公共データ利用規約 第1.0版",
    "api_version": "Ver.X.Y",
    "service_disclaimer": "このサービスは、..."
  }
}
```

## 遵守すべき条項の抽出法

対象 API の**利用規約 別添** を全て読み、以下 4 タイプを探す:

### Type 1: 出典明記義務

典型的な条項:

> 利用者は、本機能を利用したサービスを提供する場合は、「このサービスは、〇〇〇」を適宜の場所に明示するものとします。

→ **この「〇〇〇」を一字一句変えずに `service_disclaimer` に入れる**。

### Type 2: データライセンス

典型的な条項:

> コンテンツの著作権は XXX に帰属し、「公共データ利用規約（第1.0版）」に準拠した利用条件の下で利用することができます。

→ `license` フィールドに正確なライセンス名を入れる。

### Type 3: 出典記載例

典型的な条項:

> 出典の記載方法は以下のとおりです。
> （出典記載例）出典：〇〇〇サイト（〇〇機関）（URL）

→ `data_source` フィールドに正確なフォーマットで入れる。

### Type 4: 加工利用時の明示義務

典型的な条項:

> 本コンテンツを編集・加工等して利用する場合は、上記出典とは別に、編集・加工等を行ったことを記載してください。

→ `get_attribution` tool の `usage_guidance` field にこの義務を自動的に含める。

## 本プロジェクトでの実装例

`src/domain/corporate-number.ts`:

```ts
export function buildAttribution(): Attribution {
  return {
    data_source:
      '国税庁法人番号公表サイト（国税庁）https://www.houjin-bangou.nta.go.jp/',
    service_disclaimer:
      'このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。',
    license: '公共データ利用規約 第1.0版',
    api_version: 'Ver.4.0',
    accessed_at: new Date().toISOString(),
  };
}
```

- `service_disclaimer` は利用規約 別添1 第6条 の指定文言を一字一句変えずに転記
- `license` は別添3 の「公共データ利用規約 第1.0版」（第2.0版ではないことに注意、調査で訂正した）
- `accessed_at` は ISO 8601 で自動生成

## 遵守確認のテスト

```ts
// tests/integration/tools.test.ts
it('lookup_corporate_by_number は attribution 必須', async () => {
  const result = await client.callTool({
    name: 'lookup_corporate_by_number',
    arguments: { corporate_number: '5111101000006' },
  });
  const structured = result.structuredContent as { attribution: Attribution };
  expect(structured.attribution.service_disclaimer).toContain('対象機能利用して取得');
  expect(structured.attribution.license).toBe('公共データ利用規約 第1.0版');
});
```

## README への反映

```markdown
## Attribution

This project uses the XXX Web-API provided by YYY.

> **このサービスは、〇〇機能を利用して取得した情報をもとに作成しているが、
> サービスの内容は〇〇によって保証されたものではない。**

Source: **〇〇公表サイト** (https://example.gov.jp/)
License: **公共データ利用規約 第1.0版**
API Version: **Ver.X.Y**
```

これを README の最後に必ず配置する。

## 効果

- 遵法性: 利用規約の出典義務を 100% 遵守
- 信頼性: OSS 読者が「この人は規約を読んでいる」と認識する
- 安全性: LLM が出典を伝える構造を強制、誤情報拡散を予防

このテンプレートは**全ての政府 API / 公共 API 系 MCP で完全に再利用可能**。
