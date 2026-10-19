# Terms of Service

**Last updated**: 2026-10-20

> **This English version is a reference translation.** The official version is the Japanese text published at https://sugu-kuru.co.jp/mcp/houjin/terms (the same text is in [terms-of-service.md](terms-of-service.md)). If there is any discrepancy between the Japanese and English versions, the Japanese version prevails.

---

## 1. Scope and Software License

- The source code of the Service, "Japan Corporate Number & Invoice Check" (Japanese name: 法人番号・インボイス照会; GitHub repository [SUGUKURU-CO-LTD/mcp-houjin-bangou](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou)), and the npm package (`@sugukuru/mcp-houjin-bangou`) are provided under the [MIT License](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/blob/main/LICENSE).
- The use of corporate number data and qualified invoice issuer data obtained or displayed through the Service (the hosted MCP server operated by SUGUKURU CO., LTD. and the self-hosted software) is subject to these Terms and to the applicable terms of use set by the National Tax Agency (NTA).

---

## 2. NTA Data Terms and Attribution

The data handled by the Service is based on information obtained from the NTA's publication sites and Web-API. Please check and comply with the following terms according to how you use the Service.

### 2.1 NTA terms and official information to refer to

1. **Terms of Use of the NTA Corporate Number Publication Site** (based on the Public Data License (Version 1.0))
   - URL: `https://www.houjin-bangou.nta.go.jp/riyokiyaku/`
   - Main relevant part: "Important information on the Public Data License (Version 1.0) for the use of content", item 1) on stating the source
2. **Terms of Use of the NTA Qualified Invoice Issuer Publication Site** (based on the Public Data License (Version 1.0))
   - URL: `https://www.invoice-kohyo.nta.go.jp/terms-of-use.html`
   - Main relevant parts: the opening section (the information published, the handling of personal information, and the prohibition of scraping the search function), and "Important information on the Public Data License (Version 1.0) for the use of content", item 1) on stating the source
3. **Terms of Use of the Corporate Number System Web-API** (as amended effective September 24, 2026; applies when the self-hosted edition uses the Web-API for corporate number lookups)
   - URL: `https://www.houjin-bangou.nta.go.jp/webapi/riyokiyaku.html`
   - The self-hosted edition does not use the Qualified Invoice Issuer Publication System Web-API (qualified invoice issuer lookups work only when connected to a database).
   - Main relevant provisions:
     - Responsibility for managing the application ID: Article 4, paragraph (2)
     - Statement of the source of information: Article 6
     - Prohibition of large volumes of access in a short time, etc.: Article 9, paragraph (1), item (iii)
     - Prohibition of transferring, lending or disclosing the application ID to third parties: Article 9, paragraph (1), item (v)
4. **Official information**:
   - National Tax Agency: `https://www.nta.go.jp/`

### 2.2 Attribution and disclaimer

The Service includes a source statement in the responses of its data lookup tools (`lookup_corporate_by_number`, `search_corporate_by_name`, `lookup_invoice_issuer`). If you reuse or display the output of the Service, please keep the following source statements. The statements are required in Japanese; English glosses are given for reference only.

- **Hosted edition (bulk download data)**:
  - Corporate number data:
    > 出典：国税庁法人番号公表サイト（国税庁）（https://www.houjin-bangou.nta.go.jp/download/ ）。同サイトの公表データをもとにスグクル株式会社が加工して作成

    (Source: NTA Corporate Number Publication Site (National Tax Agency). Processed and prepared by SUGUKURU CO., LTD. based on the data published on that site.)
  - Qualified invoice issuer data:
    > 出典：国税庁適格請求書発行事業者公表サイト（国税庁）（https://www.invoice-kohyo.nta.go.jp/download/index.html ）。同サイトの公表データをもとにスグクル株式会社が加工して作成

    (Source: NTA Qualified Invoice Issuer Publication Site (National Tax Agency). Processed and prepared by SUGUKURU CO., LTD. based on the data published on that site.)
- **Self-hosted edition (Web-API)** (the statement designated by Article 6 of the Terms of Use of the Corporate Number System Web-API):
  > このサービスは、国税庁法人番号システムWeb-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない

  (This service is created based on information obtained using the NTA Corporate Number System Web-API function, but the content of the service is not guaranteed by the National Tax Agency.)

---

## 3. Conditions of Use and Rate Limits (Hosted Edition)

- **Read-only, anonymous access**: The hosted edition is provided as a read-only MCP server that requires no authentication.
- **Rate limits and prohibited acts**:
  - To keep the Service stable and to prevent brute-force lookups of sole proprietors' registration numbers, we apply rate limits per source IP address (in principle, up to 60 requests per minute to the `/mcp` endpoint).
  - Sending large volumes of requests in a short time, generating registration numbers (`T` + 13 digits) sequentially by machine to look them up by brute force, and interfering with the operation of the Service are prohibited.
- **Reference date of the data (monthly updates)**:
  - The hosted edition's database is updated once a month (full data as of the end of the previous month). Changes, new registrations, cancellations, expirations and deletions (process code 99, etc.) that occur during a month are not reflected until the next monthly update. Please make your final check of the latest status on the NTA's publication sites.

---

## 4. Handling of the NTA Web-API Application ID (Self-Hosted Edition)

To call the NTA Web-API directly from the self-hosted edition, you need to set an application ID that you have obtained yourself by registering with the NTA in the environment variable `NTA_APPLICATION_ID`. In accordance with the Terms of Use of the Corporate Number System Web-API, please observe the following:

- Do not transfer, lend, disclose or share your application ID with any third party (Article 9, paragraph (1), item (v) of those terms). The hosted edition does not use an NTA Web-API application ID; it serves the publicly downloadable data loaded into our database.
- Do not access the Web-API in large volumes in a short time (Article 9, paragraph (1), item (iii) of those terms). The Web-API client in this software has a built-in rate limit of one request per second by default.

---

## 5. Factual Lookups Only (No Tax or Legal Advice)

- The information provided by the Service (including whether a business is registered as a qualified invoice issuer, and the result `was_registered_on_reference_date` of comparing the registration, cancellation and expiration dates with a specified reference date) only shows **the result of a factual check comparing the dates in the NTA's public data with the reference date**.
- The Service does not provide tax consultation or tax judgments within the meaning of Article 2, paragraph (1) of the Certified Public Tax Accountant Act, such as whether input tax credits are available for a particular transaction, whether transitional measures apply, or how an election to become a taxable business or the simplified taxation system applies. For tax judgments on individual matters, please consult the competent tax office or a certified public tax accountant.

---

## 6. Disclaimer

- This software and the hosted service are provided "as is". SUGUKURU CO., LTD. and the contributors to this software make no express or implied warranty as to the completeness, accuracy, timeliness, fitness for a particular purpose or continuous availability of the Service.
- Except in cases of our willful misconduct or gross negligence, we are not liable for any damage incurred by users from the use of, or inability to use, the Service (including loss of data, interruption of business and lost profits).
- If the contract between us and a user under these Terms is a consumer contract as defined in the Consumer Contract Act, our liability for damages caused by our negligence (excluding gross negligence) is limited to direct and ordinary damages actually incurred by the user.

---

## 7. Contact

- **Operator**: SUGUKURU CO., LTD. (スグクル株式会社)
- **Address**: 〒899-4332 鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階, Japan
- **Email**: `info@sugu-kuru.co.jp`
- **Privacy Policy**: [privacy-policy.en.md](privacy-policy.en.md)
