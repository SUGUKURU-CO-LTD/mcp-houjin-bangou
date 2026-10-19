# @sugukuru/mcp-houjin-bangou

> **Model Context Protocol (MCP) server for looking up and verifying Japanese Corporate Numbers (法人番号) and Qualified Invoice Issuers (適格請求書発行事業者) published by the National Tax Agency of Japan.**

[![npm version](https://img.shields.io/npm/v/@sugukuru/mcp-houjin-bangou.svg)](https://www.npmjs.com/package/@sugukuru/mcp-houjin-bangou)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/actions/workflows/ci.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/actions/workflows/ci.yml)
[![MCP Spec 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-blue)](https://modelcontextprotocol.io/specification/2025-11-25)

🇯🇵 日本語版 README: [README.ja.md](README.ja.md)  
🔗 Official Product Pages: [Product Overview](https://sugu-kuru.co.jp/en/mcp/houjin) | [Terms of Service](https://sugu-kuru.co.jp/en/mcp/houjin/terms) | [Privacy Policy](https://sugu-kuru.co.jp/en/mcp/houjin/privacy)

## Overview

An MCP server that enables Claude, ChatGPT, Cursor, VS Code Copilot, and any MCP-compatible client to:

1. **Look up a Japanese corporation** by its 13-digit National Corporate Number (`lookup_corporate_by_number`).
2. **Search corporations by name** (`search_corporate_by_name`) with optional 2-digit prefecture filter, cursor-based pagination, and automatic company-name normalization.
3. **Verify a Qualified Invoice Issuer** by registration number (`lookup_invoice_issuer`, `T` + 13 digits), with optional factual registration check as of a specified reference date (`reference_date` → `was_registered_on_reference_date`).
4. **Validate check digits locally** (`validate_corporate_number`) with zero external network calls.
5. **Normalize fuzzy company names** (`normalize_company_name`) across Japanese corporate-name patterns (position swaps of `(株)` / `株式会社`, corporate kind extraction, English-to-Japanese suffixes, NFKC, old-to-new kanji variants, IVS stripping, and whitespace canonicalization).

---

## Two Operating Modes

### 1. Hosted / PostgreSQL Mode (Remote Streamable HTTP)

- Serves queries from a PostgreSQL 16 (`pg_trgm`) database populated monthly from the National Tax Agency's public bulk download datasets (all-records CSVs for Corporate Numbers and Qualified Invoice Issuers).
- Does not use an NTA Web-API Application ID at runtime.
- Enforces `Origin` header allowlist verification, per-IP rate limiting, and 3-role database privilege separation (`houjin_admin`, `houjin_ingest`, `houjin_reader`).

### 2. Local / Self-Hosted Mode (HTTP)

- Runs locally as an HTTP server (default port `3001`) using the user's own NTA Web-API Application ID (`NTA_APPLICATION_ID`) or a local PostgreSQL database (`DATABASE_URL`).

```bash
# Run in NTA Web-API mode (default port: 3001)
NTA_APPLICATION_ID="YOUR_NTA_APPLICATION_ID" npx @sugukuru/mcp-houjin-bangou
```

#### MCP Client Configuration Examples

##### Hosted Edition (Remote Streamable HTTP)
```json
{
  "mcpServers": {
    "houjin-bangou": {
      "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
    }
  }
}
```

##### Local HTTP Mode (Self-Hosted)
After starting the local server with the command above:
```json
{
  "mcpServers": {
    "houjin-bangou-local": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

See [`examples/`](examples/) for Cursor and VS Code configurations.

---

## Tools (5)

| Tool | Purpose | Annotations (`readOnly` / `destructive` / `idempotent` / `openWorld`*) | Notes |
|---|---|---|---|
| `lookup_corporate_by_number` | Look up 1 corporation by 13-digit corporate number | `true` / `false` / `true` / `true` | Linked to `ui://corporate-card/mcp-app.html`. |
| `search_corporate_by_name` | Search corporations by name & filters | `true` / `false` / `true` / `true` | Supports optional `prefecture` (01–47), `limit` (1–20), and `cursor`. Linked to `ui://search-results/mcp-app.html`. |
| `lookup_invoice_issuer` | Look up Qualified Invoice Issuer by `T` + 13 digits | `true` / `false` / `true` / `true` | Optional `reference_date` (`YYYY-MM-DD`) returns `was_registered_on_reference_date`. |
| `validate_corporate_number` | Local Modulo-9 check-digit validation | `true` / `false` / `true` / `false` | Pure function; no DB or network access (both modes). |
| `normalize_company_name` | Deterministic Japanese company-name normalization | `true` / `false` / `true` / `false` | Pure function; extracts normalized name, legal type, and search query (both modes). |

* **Note on `openWorld` annotation**:
`openWorldHint` is declared by the server for each tool as metadata and is not sent by clients.
- In accordance with directory submission guidelines for public/open-ended entities (v1.8 specification), data lookup tools (`lookup_corporate_by_number`, `search_corporate_by_name`, `lookup_invoice_issuer`) declare `openWorldHint: true` across both Hosted Edition and Local Mode.
- Pure calculation tools (`validate_corporate_number`, `normalize_company_name`) declare `openWorldHint: false` in both modes as they operate purely in memory without external data lookups.

---

## Prompts (3) & UI Resources (2)

- **Prompts**:
  - `company-master-record`: Normalize a company name, search NTA records, and format a clean corporate master entry (strictly corporate data only; no personal contact fields).
  - `sales-list-enrichment`: Enrich a list of company names with 13-digit corporate numbers and registered head-office addresses.
  - `customer-master-dedup`: Detect duplicate customer master records caused by notation variants, mergers, or relocations.
- **MCP Apps UI Resources (`@modelcontextprotocol/ext-apps` v1.7)**:
  - `ui://corporate-card/mcp-app.html`: Card view for corporate and invoice issuer lookup results.
  - `ui://search-results/mcp-app.html`: Table view for name search results with one-click drill-down.
  - Every tool also returns complete human-readable text (`content`) and machine-readable `structuredContent`, so clients that do not render MCP Apps UI can fulfill all workflows without loss of information.

---

## Privacy, Security & Data Freshness

- **No input logging**: Corporate numbers, invoice registration numbers, and search queries are never written to application logs.
- **Sole proprietor protection**: For individual (sole proprietor) invoice issuers, personal names, trade names, and addresses are never imported into the database or returned by any tool—only the registration number (`T` + 13 digits), entity classification, and registration/revocation/expiration dates are stored.
- **Monthly data refresh**: The hosted database is updated once per month (snapshot as of the end of the preceding month). Mid-month changes, revocations, or deletion requests (process code `99`) are reflected in the next monthly update. Every response includes `data_as_of`.
- **Factual lookup only**: Date comparisons (`was_registered_on_reference_date`) represent a mechanical comparison against published registration periods and do not constitute tax or legal advice.

---

## Documentation

- [API Reference](docs/api-reference.md)
- [Getting Started](docs/getting-started.md)
- [Usage Cookbook](docs/usage-cookbook.md)
- [Privacy Policy](docs/policy/privacy-policy.md) ([English](docs/policy/privacy-policy.en.md))
- [Terms of Service](docs/policy/terms-of-service.md) ([English](docs/policy/terms-of-service.en.md))
- [Database Roles & Privilege Separation](docs/deployment/db-roles.md)
- [Self-Hosting Guide](docs/deployment/self-hosting.md)
- [Prompt Injection Defense](docs/security/prompt-injection-defense.md)
- [Architecture Decision Records](docs/adr/)
- [SECURITY](SECURITY.md) / [CONTRIBUTING](CONTRIBUTING.md) / [CODE OF CONDUCT](CODE_OF_CONDUCT.md)

---

## Attribution

- **Corporate Number Data**: National Tax Agency Corporate Number Publication Site (`https://www.houjin-bangou.nta.go.jp/`) — Public Data License v1.0 (公共データ利用規約 第1.0版)
- **Qualified Invoice Issuer Data**: National Tax Agency Qualified Invoice Issuer Publication Site (`https://www.invoice-kohyo.nta.go.jp/`)
- **Web-API Disclaimer**:
  > このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。

## License & Maintainer

- **License**: MIT © 2026 SUGUKURU CO., LTD. (スグクル株式会社, Kagoshima, Japan)
- **Website**: [https://sugu-kuru.co.jp](https://sugu-kuru.co.jp)
- **Contact**: `info@sugu-kuru.co.jp`
