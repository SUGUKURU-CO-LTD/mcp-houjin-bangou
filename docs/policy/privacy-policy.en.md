# Privacy Policy

**Last updated**: 2026-10-19

> **This English version is a reference translation.** The official version is the Japanese text published at https://sugu-kuru.co.jp/mcp/houjin/privacy (the same text is in [privacy-policy.md](privacy-policy.md)). If there is any discrepancy between the Japanese and English versions, the Japanese version prevails.

---

## 1. Scope

This Privacy Policy describes how SUGUKURU CO., LTD. ("we", "us" or "our") handles information in **the hosted edition (remote MCP server)** and **the self-hosted edition (run locally with npx, Docker, etc.)** of "Japan Corporate Number & Invoice Check" (Japanese name: 法人番号・インボイス照会), an MCP server for looking up Japanese corporate numbers and qualified invoice issuers (npm package `@sugukuru/mcp-houjin-bangou`; the "Service").

---

## 2. Operating Modes and Data Flow

The Service can be used in the following two ways, and the flow of data differs between them.

### 2.1 Hosted edition (the remote MCP server we operate)

- Once a month, we obtain the bulk download data (full CSV files) published on the National Tax Agency (NTA) Corporate Number Publication Site and the NTA Qualified Invoice Issuer Publication Site, store it in a database we manage (Google Cloud SQL), and answer searches and lookups from that database.
- Requests to the hosted edition are processed on our servers (Google Cloud Run). The hosted edition does not contact the NTA Web-API for each request (the hosted edition does not use an NTA Web-API application ID).

### 2.2 Self-hosted edition (run in your own environment)

- If you start `npx @sugukuru/mcp-houjin-bangou` or similar in your own environment in local HTTP mode (default port `3001`), keep the data source setting (`DATA_SOURCE`) at its default value `web-api`, and set an NTA Web-API application ID that you obtained yourself (`NTA_APPLICATION_ID`), then corporate number lookups (`lookup_corporate_by_number`, `search_corporate_by_name`) are sent directly from your device to the NTA Corporate Number System Web-API.
- In this mode, qualified invoice issuer lookups (`lookup_invoice_issuer`) are not available (that tool works only when connected to a database).
- In this case, no communication or data is sent to our servers. Information recorded by the NTA (IP address, application ID, access time, etc.) is handled under the NTA's own personal information protection policy.

---

## 3. Information We Record and Do Not Record (Hosted Edition)

### 3.1 Information recorded in application logs

For operational monitoring and troubleshooting, the hosted edition's application logs record the following items for each tool call:

- The name of the tool called (e.g. `lookup_corporate_by_number`, `search_corporate_by_name`, `lookup_invoice_issuer`)
- The number of results returned and the status (success or error type)
- Processing time (milliseconds)

In addition, we record operational events such as server start and stop, rate limits being applied, and errors. These records also do not include any of the input values listed in 3.2.

### 3.2 Information not recorded in application logs (input values)

The following values that you enter into the tools are **not recorded in the application logs**:

- Corporate numbers (13 digits)
- Qualified invoice issuer registration numbers (`T` + 13 digits)
- Search terms (company names, trade names, addresses, prefectures, municipalities, etc.)

### 3.3 Infrastructure request logs and source IP addresses

The infrastructure on which the hosted edition runs (Google Cloud Armor, Google Cloud Run and Google Cloud Load Balancing) and our rate limiting handle the following information:

- **Source IP addresses and rate limiting**:
  - To prevent large volumes of requests in a short time and brute-force lookups of registration numbers, Google Cloud Armor (at the load balancer) and the application (in server memory) count requests per source IP address (rate limit: up to 60 requests per minute).
  - We do not record or store these request counts. The counts held in application memory are discarded after the counting period (60 seconds) ends.
  - Access logging on Google Cloud Load Balancing is disabled, and we do not collect access logs at the load balancer.
  - The standard HTTP request logs of Google Cloud Run record, for troubleshooting and service protection, the source IP address, request time, HTTP method, path and status code, User-Agent, response size and similar information.
- **Cookies, sessions and analytics**:
  - This MCP server operates statelessly and does not issue or keep cookies or persistent session identifiers.
  - We do not use Google Analytics or any other analytics or third-party tracking tools.

---

## 4. Public Data Held by the Hosted Edition and Handling of Sole Proprietor Information

The hosted edition's database holds the following two types of data published by the NTA:

1. **Corporate number data** (source: full data from the NTA Corporate Number Publication Site)
   - Corporate number, trade name or name, furigana (reading), location of the head office or principal office, corporate type, process code, update date, change date, reason and date of closure of the registration record, and successor corporate number
2. **Qualified invoice issuer data** (source: full data from the NTA Qualified Invoice Issuer Publication Site)
   - Registration number (`T` + 13 digits), type of person (individual / corporation, including associations without legal personality), registration date, update date, cancellation date and expiration date
   - Only where the type of person is a corporation (including associations without legal personality): name, furigana (reading), location of the head office or principal office, and location of the office in Japan used for transfers of assets in Japan

### Handling of sole proprietors' registration numbers

The qualified invoice issuer data includes the registration numbers of sole proprietors. The terms of use of the NTA Qualified Invoice Issuer Publication Site state that publishing the parts of information obtained from that site that constitute personal information (name and registration number) without the person's consent, or similar acts, may violate the Act on the Protection of Personal Information. With this in mind, we handle this data as follows:

- **What we keep and what we do not keep**:
  - For sole proprietors (type of person: individual), we load only the registration number (`T` + 13 digits), type of person, registration date, update date, cancellation date and expiration date into the database.
  - **We do not load, keep or output sole proprietors' names, common names, trade names (yago), or the addresses stated in their requests for publication.**
- **Restrictions on lookups**:
  - The `lookup_invoice_issuer` tool performs only an exact-match lookup of one registration number (`T` + 13 digits) specified by the user. We do not provide listing, prefix search, range search or bulk output of sole proprietors' registration numbers.
- **Separation of database privileges**:
  - Database roles are separated into schema management, monthly data loading, and read-only access for the MCP server. The MCP server process is granted read-only privileges (`SELECT` only).

---

## 5. Update Frequency and Reflection Lag

- The public data in the hosted edition (corporate number data and qualified invoice issuer data) is updated **once a month (full data as of the end of the previous month)** by replacing all records.
- As a result, new registrations, changes of trade name or address, cancellations and expirations that occur during a month, as well as **process code "99" (deletion) in the corporate number data** (for example, when an association without legal personality withdraws its consent to publication) and **withdrawals of sole proprietors' requests for publication in the qualified invoice issuer data**, **are not reflected in the hosted edition's database until the next monthly update**.
- Each tool response includes the reference date of the data currently held (`data_as_of`). If you need to confirm the latest status within a month, please check the NTA Corporate Number Publication Site (`https://www.houjin-bangou.nta.go.jp/`) or the NTA Qualified Invoice Issuer Publication Site (`https://www.invoice-kohyo.nta.go.jp/`) directly.

---

## 6. Purposes of Use

We use the information we obtain and hold only for the following purposes:

1. Providing factual lookups of corporate numbers and qualified invoice issuer registration numbers (checking basic corporate information, normalizing names in customer and supplier master data, and checking registration numbers stated on invoices and whether the registration was valid on the transaction date)
2. Detecting and limiting large volumes of requests in a short time, unauthorized access and brute-force lookups (rate limiting)
3. Operational monitoring, troubleshooting and security auditing of the Service

---

## 7. Provision to Third Parties and Infrastructure Subprocessors

- **Provision to third parties**: Except as required by law, we do not provide access logs, source IP addresses or similar information about the Service to third parties. (In response to a tool call, we return lookup results based on the NTA's public data to the user who made the call.)
- **Subprocessors (cloud infrastructure)**: The hosted edition and its database are operated on the following cloud infrastructure:
  - **Provider**: Google LLC (Google Cloud)
  - **Services used**:
    - **Google Cloud Run**: execution environment for the MCP server (Streamable HTTP)
    - **Google Cloud SQL for PostgreSQL**: storage and search of the public data
    - **Google Cloud Load Balancing**: HTTPS termination and load balancing (access logging disabled)
    - **Google Cloud Armor**: rate limiting per source IP address (60 requests per 60 seconds)
    - **Google Cloud Storage**: temporary storage of the CSV files for the monthly full data load (deleted promptly after the load is complete, following our operating procedure)
    - **Google Cloud Logging**: storage of application logs and Cloud Run standard request logs
  - **Data storage region**: Japan (Tokyo region, `asia-northeast1`)

---

## 8. Retention Periods

- **Infrastructure request logs and application logs**: Kept in Google Cloud Logging for **30 days** and then deleted automatically. Access logging on Google Cloud Load Balancing is disabled.
- **Request counts for rate limiting**: We do not record or store them (see 3.3).
- **Temporary data (Cloud Storage)**: CSV files placed temporarily in Cloud Storage for the monthly full data update are deleted promptly after the database load is complete, following our operating procedure ([docs/deployment/hosted.md](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/blob/main/docs/deployment/hosted.md)).
- **Public data tables and backups**:
  - When the monthly full data replacement completes successfully, the previous generation of tables is promptly deleted with `DROP TABLE`.
  - Daily automatic backups of Google Cloud SQL are kept for **7 days (7 generations)** and then discarded automatically. Point-in-time recovery (PITR) is disabled.

---

## 9. Your Options and Contact

### 9.1 Your options

- **Not sending input values to our servers**:
  - Corporate number check-digit validation (`validate_corporate_number`) and company name normalization (`normalize_company_name`) are pure functions that make no external calls. By running this package locally (HTTP mode), you can use them without any communication with our servers.
  - In addition, by obtaining your own NTA Web-API application ID and using the self-hosted edition, you can perform corporate number lookups without going through our servers.
- **Deletion or correction of public data**:
  - The public data held by the Service is based on the data published on the NTA's publication sites. For corrections of published information, withdrawal of consent to publication (process code 99), withdrawal of requests for publication and similar matters, please follow the procedures at the competent tax office, the Invoice Registration Center or the NTA. Changes reflected in the NTA's public data will be reflected when we perform our monthly data update.
  - Information whose publication has ended on the NTA's publication sites will also be deleted from the hosted edition's database at the next monthly update (full data replacement). If you would like us to act without waiting for the monthly update, please contact us using the details below. We will check the situation and let you know whether and when we can respond.
  - If you wish to request disclosure, correction, suspension of use or similar actions concerning your own personal information, please contact us using the details below.

### 9.2 Contact

- **Operator**: SUGUKURU CO., LTD. (スグクル株式会社)
- **Address**: 〒899-4332 鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階, Japan
- **Email**: `info@sugu-kuru.co.jp`
