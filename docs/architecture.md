# Architecture / アーキテクチャ

## 全体図 / Overview

```mermaid
flowchart LR
  subgraph Host["MCP Host (Client)"]
    Claude["Claude / ChatGPT"]
    Cursor["Cursor / Antigravity"]
    VSCode["VS Code Copilot"]
  end

  subgraph Server["@sugukuru/mcp-houjin-bangou (Node.js)"]
    direction TB
    Express["Express 5 + Helmet + Origin / IP Rate Limit"]
    Transport["StreamableHTTPServerTransport<br/>stateless"]
    McpLayer["McpServer (SDK v1.32)"]
    Logger["McpLogger / Pino<br/>stderr 構造化ログ（入力値非記録）"]
    subgraph Primitives["MCP Primitives & Discovery"]
      Tools["5 Tools (.strict inputSchema)"]
      Resources["2 MCP Apps UI Resources<br/>corporate-card / search-results"]
      Prompts["3 Prompts"]
      Completion["Completion handler"]
      Pagination["Pagination (queryKey + data_as_of cursor)"]
      ServerCard["Server Card<br/>/.well-known/mcp.json"]
    end
    subgraph Domain["Domain Layer (pure)"]
      CheckDigit["check-digit.ts / invoice-number.ts"]
      Normalizer["normalizer.ts"]
      Codes["kind / process / close-cause / invoice / prefecture codes"]
    end
    subgraph DataLayer["Repository, API & Ingest Layer"]
      NtaClient["NtaClient + CsvParser + TokenBucket (web-api mode)"]
      CorpRepo["DbCorporateDataProvider (db mode)"]
      InvRepo["DbInvoiceDataProvider (db mode)"]
      Ingest["DatasetImporter / CLI (atomic RENAME swap)"]
    end
  end

  subgraph External["External Data Sources"]
    NTA["国税庁 法人番号 Web-API Ver.4.0<br/>api.houjin-bangou.nta.go.jp/4"]
    DB["PostgreSQL 16 (pg_trgm)<br/>法人番号CSV (30列) / インボイスCSV (24列)"]
  end

  Host -->|"POST /mcp (JSON-RPC 2.0)"| Express
  Express --> Transport
  Transport --> McpLayer
  McpLayer --> Primitives
  Tools --> Domain
  Tools --> DataLayer
  Prompts --> Domain
  Completion --> Normalizer
  McpLayer -. logs .-> Logger
  NtaClient -->|"GET /num /name (type=02 CSV UTF-8)"| NTA
  CorpRepo --> DB
  InvRepo --> DB
  Ingest --> DB
```

## レイヤー構造 / Layered Structure

| Layer | Path | Responsibility |
|---|---|---|
| **Transport & HTTP Security** | `src/server.ts`, `src/lib/http-security.ts` | Express 5 + Helmet + Origin 検証 + IP レート制限 + Stateless Streamable HTTP |
| **MCP Protocol** | `src/mcp.ts` | `McpServer` ファクトリ + capability / `instructions` 宣言 |
| **Primitives & UI** | `src/tools/`, `src/resources/`, `src/prompts/`, `src/completion/`, `src/ui/` | 5 Tools / 2 MCP Apps UI Resources / 3 Prompts / Completion |
| **Domain** | `src/domain/` | 純粋ロジック（チェックデジット、T番号・暦日検証、社名正規化、コード表） |
| **Repository & API** | `src/repository/`, `src/api/`, `src/db/` | PostgreSQL Drizzle プロバイダ（`db` モード）/ 国税庁 Web-API クライアント（`web-api` モード） |
| **Ingestion** | `src/ingest/` | 月次全件 CSV ストリーミング取込・閾値検証・単一トランザクション `RENAME` スワップ |
| **Cross-cutting** | `src/lib/` | 環境変数検証、エラー整形（バインド値秘匿）、ロガー、カーソルページング |

## データフロー: 法人名検索 + ページング

```mermaid
sequenceDiagram
  participant C as MCP Host
  participant S as MCP Server
  participant R as RateLimiter
  participant N as 国税庁 Web-API / PostgreSQL 16

  C->>S: tools/call search_corporate_by_name<br/>{name, prefecture?, cursor?, limit?}
  alt DATA_SOURCE=web-api モード
    S->>S: validateNameSearchCursor(cursor, queryKey)
    S->>R: acquire()
    R-->>S: token granted
    S->>N: GET /4/name?name=...&divide=N&type=02
    N-->>S: CSV (header + records[])
    S->>S: parseNtaCsv(csv)
  else DATA_SOURCE=db モード（ホスト版）
    S->>N: SELECT ... FROM corporate_numbers<br/>(1-2文字: LIKE prefix%, 3文字+: ILIKE %query%, 半角/全角ASCII両対応)
    N-->>S: rows[]
  end
  S-->>C: {results, total_count, next_cursor, data_as_of, attribution}
  Note right of C: 次ページが必要なら<br/>next_cursor を cursor に指定して再呼出
```

## データフロー: 企業マスタ確認ワークフロー (Prompt + MCP Apps UI)

```mermaid
sequenceDiagram
  participant U as User
  participant LLM as MCP Host / LLM
  participant P as Prompt<br/>"company-master-record"
  participant NORM as normalize_company_name
  participant SRCH as search_corporate_by_name
  participant LOOK as lookup_corporate_by_number
  participant INV as lookup_invoice_issuer

  U->>LLM: 会社マスタ確認指示<br/>"（株）スグクルの情報を確認して"
  LLM->>P: prompts/get company-master-record<br/>{company_name: "（株）スグクル"}
  P-->>LLM: 構造化プロンプト (normalize → search → lookup)
  LLM->>NORM: tools/call normalize_company_name<br/>{raw_name: "（株）スグクル"}
  NORM-->>LLM: {normalized_name: "株式会社スグクル", legal_type: "株式会社", search_query_optimized: "スグクル"}
  LLM->>SRCH: tools/call search_corporate_by_name<br/>{name: "スグクル"}
  SRCH-->>LLM: {results: [{corporate_number: "9340001026142", ...}], ...}
  LLM->>LOOK: tools/call lookup_corporate_by_number<br/>{corporate_number: "9340001026142"}
  LOOK-->>LLM: {corporation: {...}, data_as_of, attribution} + ui://corporate-card/mcp-app.html
  opt インボイス登録も確認する場合（DBモード）
    LLM->>INV: tools/call lookup_invoice_issuer<br/>{registration_number: "T9340001026142"}
    INV-->>LLM: {status, registration_date, ...} + ui://corporate-card/mcp-app.html
  end
  LLM->>U: インタラクティブ UI カードと要約テキスト（data_as_of・出典付き）を表示
```

## プロンプトインジェクション・多層防御

```mermaid
flowchart TB
  Input["Untrusted Input / HTTP Request"]
  L0["L0: Origin Allowlist + IP Rate Limit (60 req/min) + 64KB Body Limit"]
  L1["L1: Zod .strict() inputSchema (additionalProperties: false)"]
  L2["L2: Static tool descriptions + CI grep guard + ESLint no-eval"]
  L3["L3: Env-only secrets (NTA_APPLICATION_ID / DATABASE_URL) + houjin_reader SELECT-only DB role"]
  L4["L4: Input non-logging + SQL bind-param stripping (formatErrorWithCause)"]
  L5["L5: MCP Apps UI textContent-only DOM + SHA-256 CSP + data_as_of / attribution required"]
  Output["Safe Structured & UI Output"]

  Input --> L0 --> L1 --> L2 --> L3 --> L4 --> L5 --> Output
```

## 参考 / References

- 国税庁 法人番号システム Web-API 仕様書 第一編 (4.9版) / 第二編 (1.2版) / 第六編 (1.2版) / リソース定義書 (4.0版)
- 国税庁 適格請求書発行事業者公表システム ダウンロードデータ リソース定義書 (1.5版 別紙1)
- Model Context Protocol Specification (`2025-11-25`) & MCP Apps (`@modelcontextprotocol/ext-apps` `2026-01-26`)
- SEP-2127 Server Card / SEP-1303 Input Validation as Tool Errors / SEP-986 Tool Names
- Simon Willison, "Model Context Protocol has prompt injection security problems" (2025-04-09)
