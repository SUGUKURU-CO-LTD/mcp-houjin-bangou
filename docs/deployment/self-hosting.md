# Self-hosting Guide

本ドキュメントは、本 MCP サーバーを自社環境で継続的に運用する際のガイドです。

## 前提

- Node.js `20.19.0` 以上（本番では Node.js 22 LTS 推奨）
- 以下のいずれかのデータソース：
  - **Web-API モード (`DATA_SOURCE=web-api`)**: 国税庁 法人番号 Web-API アプリケーション ID（`NTA_APPLICATION_ID`）
  - **DB モード (`DATA_SOURCE=db`)**: PostgreSQL 16（`pg_trgm` 拡張導入済み）と国税庁公開ダウンロード CSV
- systemd / Docker / pm2 等のプロセス管理ツール

## インストールとビルド

```bash
git clone https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou.git
cd mcp-houjin-bangou
pnpm install --frozen-lockfile
pnpm build
```

## systemd ユニット例

`/etc/systemd/system/mcp-houjin-bangou.service`:

```ini
[Unit]
Description=@sugukuru/mcp-houjin-bangou MCP Server
After=network.target

[Service]
Type=simple
User=nodeuser
WorkingDirectory=/opt/mcp-houjin-bangou
EnvironmentFile=/etc/mcp-houjin-bangou/.env
ExecStart=/usr/bin/node /opt/mcp-houjin-bangou/dist/server.js
Restart=on-failure
RestartSec=5s

# セキュリティ強化
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

`/etc/mcp-houjin-bangou/.env` (`chmod 600`, `chown nodeuser:nodeuser`):

```env
DATA_SOURCE=web-api
NTA_APPLICATION_ID=your-id
LOG_LEVEL=info
PORT=3001
NODE_ENV=production
TRUST_PROXY=1
ALLOWED_ORIGINS=https://claude.ai,https://chatgpt.com
```

## プロセス監視とログ

`systemd` の場合、`systemctl status mcp-houjin-bangou` および `journalctl -u mcp-houjin-bangou` で監視できます。
アプリケーションログはすべて標準エラー出力（`stderr`）に JSON 形式で出力され、入力された法人番号・登録番号・検索語は記録されません。

## 3 年無利用停止防止 (`DATA_SOURCE=web-api` 利用時: 第一編 §5.3 + 別添1 第4条第5項)

国税庁 Web-API は 3 年間アクセスがないとアプリケーション ID が停止される場合があります。定期 keep-alive スクリプトが同梱されています：

```bash
# crontab -e
# 毎週月曜 10:00 JST (UTC 01:00) に国税庁 API へ ping
0 1 * * 1 cd /opt/mcp-houjin-bangou && NTA_APPLICATION_ID=$(cat /etc/mcp-houjin-bangou/id) pnpm health-check
```

または GitHub Actions の `.github/workflows/api-health-check.yml` を利用できます。

## セキュリティ運用

1. **秘密情報は `.env` または Secret Manager で管理し、Git コミット禁止**
2. **HTTPS 化**: nginx / Caddy / Cloudflare / Cloud Load Balancing 経由で TLS を終端
3. **Origin 検証**: `ALLOWED_ORIGINS` 環境変数に許可するブラウザオリジンを明示設定
4. **レート制限と `TRUST_PROXY`**: 前段リバースプロキシの段数に合わせて `TRUST_PROXY` を設定（直結は `0`、nginx 1段は `1`）し、`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` で IP ごとに制限
5. **リクエストサイズ制限**: nginx 側で `client_max_body_size 64k;`（本サーバーも `64kb` に制限）

## nginx リバースプロキシ例

```nginx
server {
  listen 443 ssl http2;
  server_name mcp-houjin-bangou.example.com;

  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  client_max_body_size 64k;
  keepalive_timeout 75s;

  location /health {
    proxy_pass http://127.0.0.1:3001;
    access_log off;
  }

  location /.well-known/mcp.json {
    proxy_pass http://127.0.0.1:3001;
    add_header Cache-Control "public, max-age=300";
  }

  location /mcp {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_read_timeout 60s;
    proxy_buffering off;
  }
}
```

## アップデート手順

```bash
cd /opt/mcp-houjin-bangou
git fetch --tags
git checkout v1.0.2  # 対象バージョンタグ
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart mcp-houjin-bangou
```

更新時は事前に [`CHANGELOG.md`](../../CHANGELOG.md) を確認してください。

## Web-API モードと PostgreSQL DB モードの比較

| 項目 | Web-API モード (`DATA_SOURCE=web-api`) | DB モード (`DATA_SOURCE=db`) |
|---|---|---|
| データ取得元 | 国税庁 法人番号 Web-API Ver.4.0（リアルタイム） | 国税庁 公開ダウンロードデータ CSV を PostgreSQL 16 に月次取込 |
| Application ID | 利用者自身の `NTA_APPLICATION_ID` が必要 | 不要（Web-API ID を使用しない） |
| DB ロール分離 | なし | `houjin_admin` / `houjin_ingest` / `houjin_reader`（[`db-roles.md`](db-roles.md) 参照） |
| インボイス登録確認 (`lookup_invoice_issuer`) | **非対応**（`DATA_UNAVAILABLE` を返却） | **対応** |

お問い合わせは `info@sugu-kuru.co.jp` まで。
