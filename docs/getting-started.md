# Getting Started / クイックスタート

## 1. 利用形態の選択

本 MCP サーバーは **Streamable HTTP トランスポート専用** であり、用途に応じて以下の 3 通りの方法で利用できます。

1. **ホスト版（リモート Streamable HTTP・推奨・セットアップ不要）**:
   - エンドポイント `https://houjin.mcp.sugu-kuru.co.jp/mcp` をクライアントに設定するだけで、API キー不要で **全 5 ツール（`lookup_invoice_issuer` を含む）** と MCP Apps UI を即座に利用できます。
2. **ローカル Web-API モード（`DATA_SOURCE=web-api`・セルフホスト）**:
   - 国税庁から無料で発行される法人番号システム Web-API アプリケーション ID（`NTA_APPLICATION_ID`）を取得し、手元で HTTP サーバー（既定ポート `3001`）を起動して接続します。
   - ※ **注意**: ローカル `web-api` モードでは法人番号の照会・検索・検証・社名正規化の 4 ツールが動作します。適格請求書発行事業者の照会（`lookup_invoice_issuer`）はデータベース方式専用のため、`web-api` モードでは `DATA_UNAVAILABLE` を返します。
3. **ローカル / 自社 PostgreSQL DB モード（`DATA_SOURCE=db`・セルフホスト）**:
   - 国税庁の公開ダウンロードデータ（全件 CSV）を取り込んだ PostgreSQL 16 データベース（`DATABASE_URL`）に接続し、全 5 ツールを自社環境内で高速に運用します。

---

## 2. ホスト版ですぐに始める（推奨）

Claude Desktop、Cursor、ChatGPT、Google Antigravity 等の設定ファイルに以下のリモート URL を追加してクライアントを再起動するだけで完了です。

### Claude Desktop / 汎用 MCP クライアント

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
    }
  }
}
```

### Cursor（`.cursor/mcp.json` または `~/.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "type": "streamable-http",
      "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
    }
  }
}
```

### Google Antigravity CLI / IDE

```bash
agy plugin install https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou
```

---

## 3. ローカル HTTP サーバーを起動して接続する場合（セルフホスト）

### 3.1 動作環境

- **Node.js**: `20.19.0` 以上（`.nvmrc` 参照）
- **国税庁 Web-API アプリケーション ID**（`DATA_SOURCE=web-api` の場合）:
  1. [国税庁 Web-API 利用届出フォーム](https://www.invoice-kohyo.nta.go.jp/web-api/pre-reg/)（[手続案内](https://www.houjin-bangou.nta.go.jp/webapi/tetuzuki.html)）からメールアドレスを登録し、届出情報を送信します。
  2. 発行された英数字のアプリケーション ID（無料）を `NTA_APPLICATION_ID` に設定します。

### 3.2 ステップ 1: ローカル HTTP サーバーを起動する

#### Option A: `npx` で起動（インストール不要）

```bash
NTA_APPLICATION_ID="YOUR_APPLICATION_ID" npx -y @sugukuru/mcp-houjin-bangou
```

#### Option B: リポジトリをクローンしてビルド・起動

```bash
git clone https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou.git
cd mcp-houjin-bangou
pnpm install --frozen-lockfile
cp .env.example .env
# .env の NTA_APPLICATION_ID（または DATA_SOURCE=db と DATABASE_URL）を設定
pnpm build
pnpm start
```

### 3.3 ステップ 2: MCP クライアントから `http://localhost:3001/mcp` に接続する

> [!IMPORTANT]
> 本パッケージは stdio トランスポートではなく HTTP サーバー（既定ポート `3001`）として起動します。クライアント設定に `"command": "npx"` を直接指定すると応答待ちで停止するため、必ず事前にサーバーを起動したうえで `"url": "http://localhost:3001/mcp"` を指定してください。

```json
{
  "mcpServers": {
    "houjin-bangou-local": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

---

## 4. 動作確認 — 5 つのツールを試す

### UC-1: 法人番号で照会 (`lookup_corporate_by_number`)

> スグクル株式会社の法人番号 9340001026142 について、商号・本店所在地・法人種別・公表基本情報を教えてください。

### UC-2: 法人名で検索 (`search_corporate_by_name`)

> 鹿児島県の「スグクル」を含む法人を検索してください。

### UC-3: インボイス登録番号と取引日時点の有効確認 (`lookup_invoice_issuer`)

※ **ホスト版（`https://houjin.mcp.sugu-kuru.co.jp/mcp`）または `DATA_SOURCE=db` モードで利用可能**です。

> 登録番号 T9340001026142 が 2026-10-01 時点で適格請求書発行事業者として登録されていたか確認してください。

### UC-4: 会社名の表記揺れ正規化 (`normalize_company_name`)

> 「（株）髙橋商事」という会社名の表記揺れを正規化し、検索用クエリを出してください。

### UC-5: チェックデジット検証 (`validate_corporate_number`)

> 法人番号 9340001026142 のチェックデジットが正しいかローカルで検証してください。

---

## 5. 関連ドキュメント

- [API リファレンス](api-reference.md)
- [活用クックブック (Usage Cookbook)](usage-cookbook.md)
- [MCP Apps UI リソース](ui-resources.md)
- [トラブルシューティング](troubleshooting.md)
- [npx クイックスタート](deployment/npx-quickstart.md)
- [セルフホストガイド](deployment/self-hosting.md)
- [ホスト版 構築・運用手順書](deployment/hosted.md)
- [DB ロール設計と権限分離](deployment/db-roles.md)
- [プライバシーポリシー](policy/privacy-policy.md)
