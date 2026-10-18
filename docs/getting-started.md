# Getting Started / クイックスタート

## 1. 利用形態の選択

本 MCP サーバーは、以下の 2 つのモードで動作します。

1. **ローカル Web-API モード（手軽な個人・社内利用）**:
   - 国税庁から無料で発行される Web-API アプリケーション ID（`NTA_APPLICATION_ID`）を取得し、`npx` で起動します。
2. **PostgreSQL DB モード（ホスト版・高速検索・インボイス照会対応）**:
   - 国税庁の公開ダウンロードデータ（全件 CSV）を取り込んだ PostgreSQL 16 データベース（`DATABASE_URL`）に接続して動作します。

---

## 2. 国税庁アプリケーション ID の取得（ローカル Web-API モード用）

1. https://www.invoice-kohyo.nta.go.jp/web-api/pre-reg/ にアクセスします。
2. メールアドレスを入力・送信し、届いたメールの URL から届出情報を入力します。
3. 数営業日以内にアプリケーション ID（13桁）がメールで届きます（無料）。

---

## 3. 動作環境

- **Node.js**: 20.19.0 以上（`.nvmrc` で固定）
- **pnpm**: 9 以上
- **MCP クライアント**: Claude Desktop / Claude.ai / ChatGPT / Cursor / VS Code Copilot 等

---

## 4. インストールと起動方法

### Option A: npx（ゼロインストール）

```bash
NTA_APPLICATION_ID=your-id-here npx -y @sugukuru/mcp-houjin-bangou
```

### Option B: リポジトリをクローンしてビルド

```bash
git clone https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou.git
cd mcp-houjin-bangou
pnpm install
cp .env.example .env
# .env の NTA_APPLICATION_ID または DATABASE_URL を設定
pnpm build
pnpm start
```

---

## 5. Claude Desktop / Cursor の設定

`~/Library/Application Support/Claude/claude_desktop_config.json`（Claude Desktop）または `~/.cursor/mcp.json`（Cursor）に以下を追加します：

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "command": "npx",
      "args": ["-y", "@sugukuru/mcp-houjin-bangou"],
      "env": {
        "NTA_APPLICATION_ID": "YOUR_ID_HERE"
      }
    }
  }
}
```

---

## 6. 動作確認 — 5 つのツールを試す

### UC-1: 法人番号で検索 (`lookup_corporate_by_number`)

> 株式会社スグクルの法人番号 5111101000006 について、本店所在地・法人種別・インボイス登録状況を教えてください。

### UC-2: 法人名で検索 (`search_corporate_by_name`)

> 鹿児島県の「スグクル」を含む法人を検索してください。

### UC-3: インボイス登録番号と取引日時点の有効確認 (`lookup_invoice_issuer`)

> 登録番号 T1234567890123（※架空の番号例） が 2026-10-01 時点で適格請求書発行事業者として有効な登録期間内にあるか確認してください。

### UC-4: 会社名の表記揺れ正規化 (`normalize_company_name`)

> 「（株）髙橋商事」という会社名の表記揺れ正規化候補を出してください。

### UC-5: チェックデジット検証 (`validate_corporate_number`)

> 法人番号 5111101000006 のチェックデジットが正しいかローカルで検証してください。

---

## 7. 関連ドキュメント

- [API リファレンス](api-reference.md)
- [活用クックブック (Usage Cookbook)](usage-cookbook.md)
- [トラブルシューティング](troubleshooting.md)
- [セルフホストガイド](deployment/self-hosting.md)
- [DB ロール設計と権限分離](deployment/db-roles.md)
- [プライバシーポリシー](policy/privacy-policy.md)
