# ホスト版（Japan Corporate Number & Invoice Check）構築・運用手順書

本ドキュメントは、`https://houjin.mcp.sugu-kuru.co.jp` で公開するホスト版 MCP サーバーの初回構築、月次データ取り込み、`TRUST_PROXY` の実測確認、およびロールバック手順を定めます。

> **注意（公開リポジトリ上の記載ルール）**
> 本ドキュメントおよびリポジトリ内のファイルには、GCP プロジェクト ID、サービスアカウント名、通知先メールアドレスの実際の値を記載しません。実行時は環境に応じた値に置き換えてください。

---

## 1. アーキテクチャ概要

```text
Client (Claude / ChatGPT / MCP Host)
  │ HTTPS (houjin.mcp.sugu-kuru.co.jp)
  ▼
Global External Application Load Balancer
  ├─ Google-managed SSL Certificate
  ├─ Cloud Armor (Per-IP Rate Limiting: throttle / 429)
  └─ Custom Request Header: x-forwarded-for:{client_ip_address},{server_ip_address}
  │
  ▼ Serverless NEG
Cloud Run Service (houjin-bangou-mcp)
  ├─ Ingress: internal-and-cloud-load-balancing (run.app 直接アクセス拒否)
  ├─ Runtime: Node.js 22 (non-root user `node`)
  ├─ Env: DATA_SOURCE=db, TRUST_PROXY, ALLOWED_ORIGINS
  └─ DB Role: houjin_reader (SELECT only, statement_timeout=5000ms)
  │
  ▼ Cloud SQL Auth Proxy (Unix Socket)
Cloud SQL for PostgreSQL 16 (houjin-bangou-pg16)
  ▲
  ├── Cloud Run Job: houjin-bangou-migrate           (DB Role: houjin_admin)
  ├── Cloud Run Job: houjin-bangou-ingest-corporate  (DB Role: houjin_ingest + Read-only GCS Volume `/mnt/ingest`)
  └── Cloud Run Job: houjin-bangou-ingest-invoice    (DB Role: houjin_ingest + Read-only GCS Volume `/mnt/ingest`)
```

---

## 2. 初回構築手順

### 2.1 事前準備（Terraform 実行前）

1. **GCP プロジェクトの作成と課金設定**
   - 公開 MCP 専用の新規 GCP プロジェクトを作成し、請求先アカウントを紐付けます。
2. **Terraform state 用 GCS バケットの作成**
   - Terraform の state を保存する GCS バケットを作成し、バージョニングを有効化します。
3. **`backend.hcl` と `terraform.tfvars` の作成**
   - `infra/terraform/backend.hcl.example` を `infra/terraform/backend.hcl` にコピーし、state バケット名を設定します。
   - `infra/terraform/terraform.tfvars.example` を `infra/terraform/terraform.tfvars` にコピーし、プロジェクト ID・ドメイン・イメージ URI・Cloud SQL ティアとディスク容量・件数下限・取り込みジョブのタイムアウト秒数（`ingest_timeout_sec`、初回の実測で決める）・通知先メールアドレス等の変数を設定します（これら2ファイルは `.gitignore` により Git 管理外となります）。

### 2.2 API・グローバル静的 IP の先行作成と DNS 登録

Google 管理 SSL 証明書の発行には、ドメインの DNS `A` レコードがロードバランサのグローバル IP を向いている必要があります。証明書の発行待ち時間を短縮するため、先に API と IP アドレスを作成して DNS を登録します。

```bash
terraform -chdir=infra/terraform init -backend-config=backend.hcl
terraform -chdir=infra/terraform apply \
  -target=google_project_service.apis \
  -target=google_compute_global_address.lb_ip
```

1. `terraform -chdir=infra/terraform output load_balancer_ip` で出力された IPv4 アドレスを確認します。
2. `sugu-kuru.co.jp` の DNS 管理画面にて、`houjin.mcp.sugu-kuru.co.jp` の `A` レコードに上記 IP アドレスを登録します。

### 2.3 Artifact Registry の作成とコンテナイメージのビルド・プッシュ

1. Artifact Registry リポジトリを作成します。
   ```bash
   terraform -chdir=infra/terraform apply \
     -target=google_artifact_registry_repository.repo
   ```
2. コンテナイメージをビルドし、Artifact Registry へ push します（サービスと3つのジョブは同一イメージを使用し、起動コマンド・引数のみ切り替えます）。
   ```bash
   docker build -t "asia-northeast1-docker.pkg.dev/<PROJECT_ID>/houjin-bangou-mcp/server:<TAG>" .
   docker push "asia-northeast1-docker.pkg.dev/<PROJECT_ID>/houjin-bangou-mcp/server:<TAG>"
   ```

### 2.4 Cloud SQL・DB・Secret・サービスアカウント・権限の先行作成

Cloud Run サービスおよびジョブは起動・作成時に Secret Manager の `latest` バージョンを参照するため、全体 `apply` の前に Cloud SQL・DB・Secret・サービスアカウント・権限だけを `-target` で作成します。

```bash
terraform -chdir=infra/terraform apply \
  -target=google_sql_database_instance.postgres \
  -target=google_sql_database.database \
  -target=google_secret_manager_secret.db_url_reader \
  -target=google_secret_manager_secret.db_url_ingest \
  -target=google_secret_manager_secret.db_url_admin \
  -target=google_service_account.service \
  -target=google_service_account.ingest \
  -target=google_service_account.migrate \
  -target=google_project_iam_member.service_cloudsql_client \
  -target=google_project_iam_member.ingest_cloudsql_client \
  -target=google_project_iam_member.migrate_cloudsql_client \
  -target=google_secret_manager_secret_iam_member.reader_secret_access \
  -target=google_secret_manager_secret_iam_member.ingest_secret_access \
  -target=google_secret_manager_secret_iam_member.admin_secret_access
```

### 2.5 DB のロールとユーザー作成・Secret Manager への値登録

DB のユーザーとパスワードは Terraform state に残さないため、[`docs/deployment/db-roles.md`](./db-roles.md) および [`docs/deployment/db-roles.sql`](./db-roles.sql) に従って手動で設定します。

1. **Phase 1 & 2 の実行（ロールと拡張の作成）**
   - Cloud SQL の管理者ユーザーで接続し、`docs/deployment/db-roles.sql` の Phase 1・Phase 2、および接続用ユーザー（`houjin_admin`, `houjin_ingest`, `houjin_reader` を継承するログインユーザー）を作成します。
2. **Secret Manager への接続文字列登録**
   - Terraform が作成した3つの Secret（`houjin-db-url-admin`, `houjin-db-url-ingest`, `houjin-db-url-reader`）に対し、Unix ソケット形式の接続文字列を登録します。
   - 形式例:
     `postgresql://<USER>:<PASSWORD>@localhost/corp_check?host=/cloudsql/<PROJECT_ID>:asia-northeast1:houjin-bangou-pg16`

### 2.6 Terraform 全体適用・マイグレーション・Phase 3 の実行

1. **Terraform 全体の適用**
   - Cloud Run サービス、3つの Cloud Run Job、Cloud Armor、外部 Application Load Balancer、監視・アラートを含めて全体を適用します。
   ```bash
   terraform -chdir=infra/terraform apply
   ```
2. **`migrate` ジョブの実行**
   - Cloud Run Job `houjin-bangou-migrate`（内部コマンド: `node dist/db/migrate.js`）を実行し、テーブルと索引を作成します。
   ```bash
   gcloud run jobs execute houjin-bangou-migrate --region=asia-northeast1 --wait
   ```
3. **Phase 3 の実行（テーブル所有権とデフォルト権限の付与）**
   - マイグレーション完了後、`docs/deployment/db-roles.sql` の Phase 3 を実行し、`corporate_numbers` / `invoice_issuers` の所有権を `houjin_ingest` に移譲し、`houjin_reader` に `SELECT` 権限および `ALTER DEFAULT PRIVILEGES` を設定します。

### 2.7 SSL 証明書の有効化と直接アクセス遮断の確認

1. **SSL 証明書のステータス確認**
   - Google 管理 SSL 証明書（`houjin-bangou-ssl-cert`）のステータスが `ACTIVE` になっていることを確認します。
2. **`run.app` URL への直接アクセス拒否の確認**
   - Cloud Run サービスの `ingress` は `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` に設定されています。
   - `terraform output cloud_run_service_uri` の `*.run.app` URL に直接 HTTP リクエストを送り、アクセスが拒否されることを確認します。

---

## 3. 月次データ取り込み手順（手動運用）

提出版では、月1回、国税庁の公表サイトから全件データ（CSV・UTF-8）をダウンロードして展開し、GCS バケットに配置したうえで Cloud Run Job を実行します。

### 3.1 一次資料（ダウンロード元 URL とファイル種別）

1. **法人番号公表サイト（基本3情報全件データ）**
   - ダウンロードページ: https://www.houjin-bangou.nta.go.jp/download/zenken/index.html
   - リソース定義書（4.0版、全30項目）: https://www.houjin-bangou.nta.go.jp/pc/download/images/k-resource-dl.pdf
   - **選択するファイル**:
     - 種別: **「CSV形式・Unicode」**（`#csv-unicode` セクション）
     - 地域: **「全国」**（ファイルサイズが大きい場合は複数 zip に分割提供されます）
   - **基準日（`--data-as-of`）**:
     - ページ上に記載されている更新日（例: `令和8年9月30日更新` であれば `2026-09-30`）を指定します。

2. **適格請求書発行事業者公表サイト（インボイス全件データ）**
   - ダウンロードページ: https://www.invoice-kohyo.nta.go.jp/download/index.html
   - リソース定義書（1.5版 別紙1、全24項目）: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf
   - **選択するファイル**:
     - 種別: 全件データの **「CSV形式・Unicode（UTF-8）」**（全国分、分割ファイルすべて）
   - **基準日（`--data-as-of`）**:
     - ダウンロードページに記載されているデータの基準日（`YYYY-MM-DD`）を指定します。

### 3.2 GCS バケットへの配置

ダウンロードした zip ファイルをすべて展開し、取り込み用 GCS バケットの以下のパスへ `.csv` ファイルをアップロードします。

- 法人番号データ:
  `gs://<INGEST_BUCKET>/corporate/<YYYY-MM>/*.csv`
- インボイスデータ:
  `gs://<INGEST_BUCKET>/invoice/<YYYY-MM>/*.csv`

> `src/ingest/cli.ts` は指定ディレクトリ直下の `.csv` ファイルをファイル名の昇順で読み込み、1つのデータセットバージョンとしてストリーミング投入したうえで、全索引を構築してから単一トランザクションの `RENAME` で本番テーブルと入れ替えます。

### 3.3 Cloud Run Job（`houjin-bangou-ingest-corporate` / `houjin-bangou-ingest-invoice`）の実行

GCS バケットはジョブコンテナ内の `/mnt/ingest` に読み取り専用でマウントされています。
各ジョブは `command` に CLI スクリプトと `--type`（`corporate` / `invoice`）が固定定義されており、実行時の `--args` はコンテナの `args` を置き換える仕様のため、実行時は `--dir` と `--data-as-of` のみを安全に渡すことができます（`INGEST_MIN_RECORD_COUNT` もジョブ側の環境変数で設定済み。タイムアウト `ingest_timeout_sec` は初回の実測で決定）。

1. **法人番号データの取り込み実行**
   ```bash
   gcloud run jobs execute houjin-bangou-ingest-corporate \
     --region=asia-northeast1 \
     --args="--dir,/mnt/ingest/corporate/2026-10,--data-as-of,2026-09-30" \
     --wait
   ```

2. **インボイスデータの取り込み実行**
   ```bash
   gcloud run jobs execute houjin-bangou-ingest-invoice \
     --region=asia-northeast1 \
     --args="--dir,/mnt/ingest/invoice/2026-10,--data-as-of,2026-09-30" \
     --wait
   ```

### 3.4 終了コードとログ・件数の確認

- **CLI 終了コード**:
  - `0`: 入れ替え完了（`status: "active"`）
  - `1`: 失敗（件数下限未満、稼働中件数比 90% 未満、不正行比率超過、引数不正、DB エラー等。前の active なデータと `data_as_of` がそのまま維持されます）
  - `2`: 別の取り込みが実行中のためスキップ（PostgreSQL アドバイザリーロックによる排他制御、`status: "skipped"`）
- **ログ確認**:
  - Cloud Logging で `jsonPayload.logger="dataset_ingest"` のログを1行確認し、`status: "active"`、`count`（取り込み件数）、`duration_ms`、`data_as_of` が記録されていること、かつ公表件数と大きくずれていないことを確認します。

### 3.5 取り込み成功後の GCS 一時フォルダの削除

取り込みが正常に完了（終了コード 0、`status: "active"`）したことを確認した後、プライバシーポリシー（第8条）の規定に基づき、取り込み用 GCS バケットに一時配置した該当月の CSV フォルダを速やかに削除します。

```bash
gcloud storage rm --recursive "gs://<INGEST_BUCKET>/corporate/<YYYY-MM>/"
gcloud storage rm --recursive "gs://<INGEST_BUCKET>/invoice/<YYYY-MM>/"
```

---

## 4. `TRUST_PROXY` とレート制限の実測手順

外部 Application Load Balancer のバックエンドサービスでは、カスタムリクエストヘッダー `x-forwarded-for:{client_ip_address},{server_ip_address}` を設定してクライアントからの偽装ヘッダーを上書きしています。デプロイ後、以下の手順で `TRUST_PROXY`（初期値 `2`）が正しく機能していることを実測します。

1. **別回線2つでの独立カウント確認**
   - 異なるグローバル IP を持つ2つの回線（例: オフィス回線とモバイル回線）を用意します。
   - 回線 A から `https://houjin.mcp.sugu-kuru.co.jp/mcp` へ短時間にリクエストを連続送信し、HTTP `429 Too Many Requests` が返る状態にします。
   - 直ちに回線 B からリクエストを送信し、回線 B は `429` にならず正常に `200 OK` で応答することを確認します（もし回線 B も巻き込まれる場合は、Express の `req.ip` がロードバランサの IP を掴んでいるため、`trust_proxy` の段数を調整します）。
2. **`X-Forwarded-For` 偽装による制限回避ができないことの確認**
   - 制限に達している回線 A から、リクエスト毎にランダムな `X-Forwarded-For: 203.0.113.<N>` ヘッダーを付与して送信します。
   - 偽装ヘッダーを付与しても制限を回避できず、引き続き `429` で拒否されることを確認します。
3. **オリジン制限（`ALLOWED_ORIGINS`）の確認**
   - 許可されていない `Origin` ヘッダー（例: `Origin: https://evil.example.com`）を付与して `/mcp` を呼び出し、`403 Forbidden` になることを確認します。
   - `Origin` ヘッダーなし（デスクトップクライアント等）および許可済みオリジン（Claude / ChatGPT）からは正常に接続できることを確認します。

---

## 5. アラート通知の試験手順

1. GCS バケットの試験用パス（例: `gs://<INGEST_BUCKET>/test-invalid/broken.csv`）に、列数が不正なダミー CSV を配置します。
2. `houjin-bangou-ingest-corporate` ジョブを `--dir,/mnt/ingest/test-invalid` で手動実行して意図的に失敗させます。
3. 本番データが壊れず前の版のまま維持されていること、および通知先メールアドレスにアラート通知が届くことを確認します。
4. 試験用パス（`gs://<INGEST_BUCKET>/test-invalid/`）を削除します。

---

## 6. 戻す基準とロールバック手順

### 6.1 戻す基準（提出延期・切り戻し判断）

以下のいずれかが発生した場合は、原因が解消されるまで変更を切り戻します。

1. 公開 URL（`https://houjin.mcp.sugu-kuru.co.jp/mcp`）で `tools/list` が失敗する。
2. 実測で、別々の接続元 IP が同一枠としてまとめて数えられてしまう（または偽装ヘッダーで制限をすり抜けられる）。
3. 取り込み後の件数が国税庁の公表件数と大きくずれる。

### 6.2 ロールバック手順

1. **コンテナイメージの切り戻し**
   - Cloud Run サービスのイメージタグを直前の正常稼働リビジョンに戻します（または `terraform.tfvars` の `image` を前バージョンのダイジェスト／タグに戻して `terraform apply` を実行します）。
2. **データセットの切り戻し（万一不正なデータが active になった場合）**
   - 自動検証で中止された場合は自動的に前の `active` 版が維持されているため操作は不要です。
   - 万一、入れ替え完了後にデータの不備が判明した場合は、直前の正常な月次 CSV ディレクトリを指定して `houjin-bangou-ingest-corporate` または `houjin-bangou-ingest-invoice` ジョブを再実行するか、Cloud SQL の日次自動バックアップから復元します。

