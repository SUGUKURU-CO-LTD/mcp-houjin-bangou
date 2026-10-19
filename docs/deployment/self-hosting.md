# Self-hosting Guide

本ドキュメントは、本 MCP サーバーを自社環境で継続的に運用する際のガイドです。

## 前提

- Node.js 20.19.0 (本番では LTS を推奨)
- 国税庁 Web-API アプリケーション ID
- systemd / Docker Compose / pm2 / supervisord 等のプロセス管理ツール

## インストール

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
ReadWritePaths=/var/log/mcp-houjin-bangou

[Install]
WantedBy=multi-user.target
```

`/etc/mcp-houjin-bangou/.env` (chmod 600, chown nodeuser:nodeuser):

```env
NTA_APPLICATION_ID=your-id
LOG_LEVEL=info
PORT=3001
NODE_ENV=production
```

## プロセス監視

`systemd` の場合 `systemctl status mcp-houjin-bangou` + journald。
pino の JSON ログが journald 経由で Datadog/Loki 等に転送できます。

## 3 年無利用停止防止 (第一編 §5.3 + 別添1 第4条第5項)

国税庁は 3 年間 API にアクセスがないとアプリケーション ID を停止できます。本プロジェクトには健康チェック cron が同梱されています:

```bash
# crontab -e
# 毎週月曜 10:00 JST (UTC 01:00) に国税庁 API へ ping
0 1 * * 1 cd /opt/mcp-houjin-bangou && NTA_APPLICATION_ID=$(cat /etc/mcp-houjin-bangou/id) pnpm health-check
```

または GitHub Actions の `api-health-check.yml` を使えば、自社サーバ側での cron 設定は不要です。

## セキュリティ運用

1. **Application ID は `.env` に保存、git commit 禁止** — `.gitignore` で除外済み
2. **HTTPS 化** — nginx/Caddy/Cloudflare 経由で TLS を提供
3. **Origin validation** — 本サーバーの `ALLOWED_ORIGINS` 環境変数、および nginx で制御
4. **rate limiting** — 本サーバー内の HTTP レート制限（`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`）および nginx 側で IP 毎に制限
5. **DoS 対策** — `client_max_body_size 64k;` (本 MCP も 64kB に制限)

## nginx reverse proxy 例

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
    proxy_set_header Connection "";
    proxy_read_timeout 60s;
    proxy_buffering off;  # SSE の場合
  }
}
```

## ログローテーション

pino → journald/fluentd に流すのが最も簡単ですが、ファイルに落とすなら:

```bash
node dist/server.js 2>&1 | logger -t mcp-houjin-bangou
```

## アップデート手順

```bash
cd /opt/mcp-houjin-bangou
git fetch --tags
git checkout v1.0.0  # 新バージョン
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart mcp-houjin-bangou
```

breaking change がある場合は `CHANGELOG.md` を必ず確認。

## ローカル（Web-API）運用と DB（公開ダウンロードデータ）運用の比較

| 項目 | Web-API モード (`DATA_SOURCE=web-api`) | DB モード (`DATA_SOURCE=db`) |
|---|---|---|
| データ取得元 | 国税庁 Web-API (リアルタイム) | 国税庁 公開ダウンロードデータ CSV を PostgreSQL に取り込み |
| Application ID | 利用者自身の `NTA_APPLICATION_ID` が必要 | 不要（Web-API ID を使用しない） |
| DB ロール分離 | なし | `houjin_admin` / `houjin_ingest` / `houjin_reader`（[db-roles.md](db-roles.md) 参照） |
| インボイス登録確認 (`lookup_invoice_issuer`) | ローカル DB 接続時、またはリモート接続時に対応 | 対応 |

お問い合わせは `info@sugu-kuru.co.jp` まで。
