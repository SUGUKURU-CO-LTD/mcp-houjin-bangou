# Architecture / アーキテクチャ

## 全体図 / Overview

```mermaid
flowchart LR
  subgraph Host["MCP Host (Client)"]
    Claude["Claude Desktop"]
    Cursor["Cursor"]
    VSCode["VS Code Copilot"]
  end

  subgraph Server["@sugukuru/mcp-houjin-bangou (Node.js)"]
    direction TB
    Express["Express 4"]
    Transport["StreamableHTTPServerTransport<br/>stateless"]
    McpLayer["McpServer (SDK v1)"]
    Logger["McpLogger<br/>stderr への構造化ログ<br/>（MCP の notifications/message は送らない）"]
    subgraph Primitives["6 MCP Primitives"]
      Tools["5 Tools"]
      Resources["2 UI Resources"]
      Prompts["3 Prompts"]
      Completion["Completion handler"]
      Pagination["Pagination (cursor)"]
      ServerCard["Server Card<br/>/.well-known/mcp.json"]
    end
    subgraph Domain["Domain Layer (pure)"]
      CheckDigit["check-digit.ts"]
      Normalizer["normalizer.ts"]
      Codes["kind / process / close-cause / prefecture codes"]
    end
    subgraph Api["Data Access Layer"]
      NtaClient["NtaClient (web-api mode)"]
      DbClient["PostgreSQL Drizzle (db mode)"]
      CsvParser["csv-parser"]
      RateLimiter["TokenBucket<br/>1 RPS + backoff"]
    end
  end

  subgraph External["External"]
    NTA["国税庁 Web-API Ver.4.0<br/>api.houjin-bangou.nta.go.jp/4"]
    DB["PostgreSQL 16+<br/>(Cloud SQL / Docker)"]
  end

  Host -->|POST /mcp<br/>JSON-RPC 2.0| Express
  Express --> Transport
  Transport --> McpLayer
  McpLayer --> Primitives
  Tools --> Domain
  Tools --> Api
  Resources --> Domain
  Prompts --> Domain
  Completion --> Normalizer
  McpLayer -. logs .-> Logger
  NtaClient --> RateLimiter
  NtaClient --> CsvParser
  NtaClient -->|"GET /num /name<br/>type=02 CSV UTF-8"| NTA
  DbClient --> DB
```

## レイヤー構造 / Layered Structure

| Layer | Path | Responsibility |
|---|---|---|
| **Transport** | `src/server.ts` | Express + Streamable HTTP boot + stateless transport |
| **MCP Protocol** | `src/mcp.ts` | McpServer factory + capability negotiation |
| **Primitives** | `src/tools/` `src/resources/` `src/prompts/` `src/completion/` | Tool / Resource / Prompt / Completion handlers |
| **Domain** | `src/domain/` | 純粋ロジック (check-digit, normalizer, codes) |
| **Data Access** | `src/api/` `src/db/` | NTA API client (Web-API) / Drizzle ORM (DB) |
| **Cross-cutting** | `src/lib/` | env / errors / result / logger / pagination |

## データフロー: 法人名検索 + ページング

```mermaid
sequenceDiagram
  participant C as MCP Host
  participant S as MCP Server
  participant R as RateLimiter
  participant N as 国税庁 API / DB

  C->>S: tools/call search_corporate_by_name<br/>{name, prefecture?, cursor?, limit?}
  alt Web-API モード
    S->>S: decodeCursor(cursor) → divide=N
    S->>R: acquire()
    R-->>S: token granted
    S->>N: GET /4/name?name=...&divide=N&type=02
    N-->>S: CSV (header + records[])
    S->>S: parseNtaCsv(csv)
  else DB モード
    S->>N: SELECT ... FROM corporate_numbers WHERE ... LIMIT limit OFFSET cursor
    N-->>S: rows[]
  end
  S-->>C: {results, total_count, next_cursor, data_as_of, attribution}
  Note right of C: 次ページが必要なら<br/>next_cursor を cursor に指定して再呼出
```

## データフロー: 企業マスタ確認ワークフロー (Prompt)

```mermaid
sequenceDiagram
  participant U as User
  participant LLM as Claude
  participant P as Prompt<br/>"company-master-record"
  participant NORM as normalize_company_name
  participant SRCH as search_corporate_by_name
  participant CARD as ui://corporate-card/...

  U->>LLM: 会社マスタ確認指示<br/>"（株）スグクルの情報を確認して"
  LLM->>P: prompts/get company-master-record<br/>{company_name: "（株）スグクル"}
  P-->>LLM: 構造化プロンプト (normalize → search → lookup)
  LLM->>NORM: tools/call normalize_company_name<br/>{raw_name: "（株）スグクル"}
  NORM-->>LLM: {normalized_name: "スグクル株式会社", legal_type: "株式会社", search_query_optimized: "スグクル"}
  LLM->>SRCH: tools/call search_corporate_by_name<br/>{name: "スグクル"}
  SRCH-->>LLM: {results: [{corporate_number: "9340001026142", ...}], total_count: 1, ...}
  LLM->>U: 企業情報カード UI (corporate-card) と要約テキストを表示

## プロンプトインジェクション防御層

```mermaid
flowchart TB
  Input["Untrusted LLM Input"]
  L1["L1: Zod strict input validation<br/>additionalProperties: false"]
  L2["L2: Static tool description<br/>CI grep guard"]
  L3["L3: Env-only Application ID<br/>never via tool args"]
  L4["L4: Rate limit + backoff<br/>1 RPS token bucket"]
  L5["L5: Log redaction<br/>***REDACTED***"]
  L6["L6: Attribution required<br/>on every output"]
  Api["NTA Web-API"]
  Output["Safe Output"]

  Input --> L1
  L1 --> L2
  L2 --> L3
  L3 --> L4
  L4 --> Api
  Api --> L5
  L5 --> L6
  L6 --> Output
```

## 参考 / References

- 国税庁 Web-API 仕様書 第一編 (4.9版) / 第二編 (1.2版) / 第六編 (1.2版)
- MCP 公式仕様 (2025-11-25)
- 2026 MCP Roadmap (2026-03-09)
- Transport WG "Exploring the Future of MCP Transports" (2025-12-19)
- SEP-2127 Server Card (Draft) / SEP-1303 Input Validation (Final) / SEP-986 Tool Names (Final)
- Simon Willison "MCP has prompt injection security problems" (2025-04-09)
