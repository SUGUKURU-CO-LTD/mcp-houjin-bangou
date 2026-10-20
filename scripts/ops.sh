#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"
TFVARS_FILE="${TF_DIR}/terraform.tfvars"
ADC_FILE="${HOME}/.config/gcloud/application_default_credentials.json"

PROJECT_ID=""
REGION="asia-northeast1"
DOMAIN="houjin.mcp.sugu-kuru.co.jp"
LOGGING_BUCKET_ID=""

usage() {
  cat <<'EOF'
Usage:
  scripts/ops.sh preflight
  scripts/ops.sh release
  scripts/ops.sh ingest <invoice|corporate> <YYYY-MM> <YYYY-MM-DD>
  scripts/ops.sh status
EOF
}

fail() {
  echo "エラー: $*" >&2
  exit 1
}

read_tfvar() {
  local key="$1"
  if [[ ! -f "${TFVARS_FILE}" ]]; then
    return 1
  fi
  sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]+)\".*/\1/p" "${TFVARS_FILE}" | head -n 1
}

check_base_preflight() {
  # (a) GOOGLE_APPLICATION_CREDENTIALS が設定されていれば unset して警告を表示する
  if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "警告: GOOGLE_APPLICATION_CREDENTIALS が設定されていたため、このスクリプト内では unset しました。" >&2
    unset GOOGLE_APPLICATION_CREDENTIALS
  fi

  # (b) gcloud auth print-access-token と gcloud auth application-default print-access-token が成功する（トークンは表示しない）
  if ! gcloud auth print-access-token >/dev/null 2>&1; then
    echo "gcloud auth login / gcloud auth application-default login を実行してください" >&2
    exit 1
  fi
  if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "gcloud auth login / gcloud auth application-default login を実行してください" >&2
    exit 1
  fi

  # (c) ADC のアカウントがサービスアカウントでない（~/.config/gcloud/application_default_credentials.json の type が authorized_user）
  if [[ ! -f "${ADC_FILE}" ]]; then
    fail "ADC ファイル (${ADC_FILE}) が見つかりません。gcloud auth application-default login を実行してください。"
  fi
  local adc_type
  adc_type="$(sed -n -E 's/.*"type"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${ADC_FILE}" | head -n 1)"
  if [[ "${adc_type}" != "authorized_user" ]]; then
    fail "ADC の type が authorized_user ではありません (検出値: ${adc_type:-不明})。サービスアカウントではなくユーザー認証 (gcloud auth application-default login) を使用してください。"
  fi

  # (d) infra/terraform/terraform.tfvars から project_id を読み取り、以降の gcloud にすべて --project を付ける
  if [[ ! -f "${TFVARS_FILE}" ]]; then
    fail "${TFVARS_FILE} が見つかりません。"
  fi
  PROJECT_ID="$(read_tfvar "project_id")"
  if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "<YOUR_GCP_PROJECT_ID>" ]]; then
    fail "${TFVARS_FILE} から有効な project_id を読み取れませんでした。"
  fi

  local tf_region
  tf_region="$(read_tfvar "region")"
  if [[ -n "${tf_region}" ]]; then
    REGION="${tf_region}"
  fi

  local tf_domain
  tf_domain="$(read_tfvar "domain")"
  if [[ -n "${tf_domain}" ]]; then
    DOMAIN="${tf_domain}"
  fi

  local tf_logging_bucket
  tf_logging_bucket="$(read_tfvar "logging_bucket_id")"
  if [[ -n "${tf_logging_bucket}" && "${tf_logging_bucket}" != "<LOGGING_BUCKET_ID>" ]]; then
    LOGGING_BUCKET_ID="${tf_logging_bucket}"
  fi
}

check_docker_and_git() {
  # (e) Docker が起動している
  if ! docker info >/dev/null 2>&1; then
    fail "Docker が起動していません。Docker Desktop を起動してから再実行してください。"
  fi

  # (f) git の現在ブランチが main で、未コミットの変更がなく、origin/main と一致している
  local current_branch
  current_branch="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
  if [[ "${current_branch}" != "main" ]]; then
    fail "現在の Git ブランチが main ではありません (現在: ${current_branch})。"
  fi

  local status_output
  status_output="$(git -C "${REPO_ROOT}" status --porcelain)"
  if [[ -n "${status_output}" ]]; then
    fail "Git 作業ツリーに未コミットの変更があります。"
  fi

  git -C "${REPO_ROOT}" fetch origin main --quiet
  local head_sha origin_main_sha
  head_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  origin_main_sha="$(git -C "${REPO_ROOT}" rev-parse origin/main)"
  if [[ "${head_sha}" != "${origin_main_sha}" ]]; then
    fail "HEAD (${head_sha}) が origin/main (${origin_main_sha}) と一致していません。"
  fi
}

cmd_preflight() {
  check_base_preflight
  check_docker_and_git
  echo "preflight OK (project_id=${PROJECT_ID}, region=${REGION}, branch=main)"
}

print_dataset_ingest_logs() {
  local limit="${1:-10}"
  local filter='jsonPayload.logger="dataset_ingest"'
  local format='table(severity,jsonPayload.status,jsonPayload.count,jsonPayload.duration_ms,jsonPayload.msg)'
  local resource_names="projects/${PROJECT_ID}"
  if [[ -n "${LOGGING_BUCKET_ID}" ]]; then
    resource_names="projects/${PROJECT_ID},projects/${PROJECT_ID}/locations/${REGION}/buckets/${LOGGING_BUCKET_ID}/views/_AllLogs"
  fi

  gcloud logging read "${filter}" \
    --project="${PROJECT_ID}" \
    --resource-names="${resource_names}" \
    --limit="${limit}" \
    --format="${format}"
}

cmd_release() {
  cmd_preflight

  local tag image_uri
  tag="1.0.0-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
  image_uri="${REGION}-docker.pkg.dev/${PROJECT_ID}/houjin-bangou-mcp/mcp-houjin-bangou:${tag}"

  echo "=== 1. コンテナイメージのビルドとプッシュ (${image_uri}) ==="
  (
    cd "${REPO_ROOT}"
    docker buildx build --platform linux/amd64 -t "${image_uri}" --push .
  )

  echo "=== 2. Artifact Registry 上のタグ存在確認 ==="
  gcloud artifacts docker images describe "${image_uri}" \
    --project="${PROJECT_ID}" >/dev/null
  echo "Artifact Registry にてイメージを確認しました: ${image_uri}"

  echo "=== 3. infra/terraform/terraform.tfvars の image 更新 ==="
  local tmp_tfvars
  tmp_tfvars="$(mktemp "${TFVARS_FILE}.tmp.XXXXXX")"
  awk -v new_image="${image_uri}" '
    /^[[:space:]]*image[[:space:]]*=/ {
      print "image                             = \"" new_image "\""
      next
    }
    { print }
  ' "${TFVARS_FILE}" > "${tmp_tfvars}"
  mv "${tmp_tfvars}" "${TFVARS_FILE}"

  echo "=== 4. Terraform Plan の実行 ==="
  mkdir -p "${REPO_ROOT}/.local" "${TF_DIR}/.local"
  local plan_out
  plan_out="$(mktemp "${REPO_ROOT}/.local/tfplan-output.XXXXXX")"

  if ! env -u GOOGLE_APPLICATION_CREDENTIALS terraform -chdir="${TF_DIR}" plan -no-color -out=.local/release.tfplan | tee "${plan_out}"; then
    rm -f "${plan_out}"
    fail "terraform plan が失敗しました。"
  fi

  local plan_line add_count change_count destroy_count
  plan_line="$(grep -E '^Plan: [0-9]+ to add, [0-9]+ to change, [0-9]+ to destroy\.' "${plan_out}" || true)"
  rm -f "${plan_out}"

  if [[ -n "${plan_line}" ]]; then
    add_count="$(echo "${plan_line}" | sed -E 's/^Plan: ([0-9]+) to add, ([0-9]+) to change, ([0-9]+) to destroy\./\1/')"
    change_count="$(echo "${plan_line}" | sed -E 's/^Plan: ([0-9]+) to add, ([0-9]+) to change, ([0-9]+) to destroy\./\2/')"
    destroy_count="$(echo "${plan_line}" | sed -E 's/^Plan: ([0-9]+) to add, ([0-9]+) to change, ([0-9]+) to destroy\./\3/')"
  else
    add_count=0
    change_count=0
    destroy_count=0
  fi

  echo "Terraform Plan 集計: add=${add_count}, change=${change_count}, destroy=${destroy_count}"
  if (( destroy_count >= 1 )); then
    fail "destroy が ${destroy_count} 件含まれているため中止します。"
  fi

  local confirm
  read -r -p "terraform apply を続行しますか？ (y/N): " confirm
  if [[ "${confirm}" != "y" ]]; then
    echo "リリースを中止しました。"
    exit 0
  fi

  echo "=== 5. Terraform Apply の実行 ==="
  env -u GOOGLE_APPLICATION_CREDENTIALS terraform -chdir="${TF_DIR}" apply .local/release.tfplan

  echo "=== 6. Cloud Run サービスのイメージと最新 Ready リビジョン ==="
  gcloud run services describe houjin-bangou-mcp \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="table(status.latestReadyRevisionName,spec.template.spec.containers[0].image)"
}

cmd_ingest() {
  if [[ $# -ne 3 ]]; then
    usage >&2
    fail "ingest には <invoice|corporate> <YYYY-MM> <YYYY-MM-DD> の3つの引数が必要です。"
  fi

  local dataset_type="$1"
  local year_month="$2"
  local data_as_of="$3"

  if [[ "${dataset_type}" != "invoice" && "${dataset_type}" != "corporate" ]]; then
    fail "種別は invoice または corporate を指定してください (指定値: ${dataset_type})。"
  fi
  if [[ ! "${year_month}" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
    fail "対象年月は YYYY-MM 形式で指定してください (指定値: ${year_month})。"
  fi
  if [[ ! "${data_as_of}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    fail "基準日は YYYY-MM-DD 形式で指定してください (指定値: ${data_as_of})。"
  fi

  # preflight のうち Docker と git 以外（(a)〜(d)）を実行
  check_base_preflight

  local job_name="houjin-bangou-ingest-${dataset_type}"
  local mount_dir="/mnt/ingest/${dataset_type}/${year_month}"

  echo "=== Cloud Run Job 実行: ${job_name} (dir=${mount_dir}, data-as-of=${data_as_of}) ==="
  gcloud run jobs execute "${job_name}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --args="--dir,${mount_dir},--data-as-of,${data_as_of}" \
    --wait

  echo "=== 直近の dataset_ingest ログ ==="
  print_dataset_ingest_logs 5
}

cmd_status() {
  check_base_preflight

  echo "=== 1. Cloud Run サービス (houjin-bangou-mcp) ==="
  gcloud run services describe houjin-bangou-mcp \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="table(metadata.name,status.latestReadyRevisionName,spec.template.spec.containers[0].image)"

  echo ""
  echo "=== 2. Cloud Run ジョブ (3本) ==="
  local job
  for job in houjin-bangou-migrate houjin-bangou-ingest-corporate houjin-bangou-ingest-invoice; do
    gcloud run jobs describe "${job}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --format="table(metadata.name,spec.template.spec.template.spec.containers[0].image,status.latestCreatedExecution.name,status.latestCreatedExecution.completionTime)"
  done

  echo ""
  echo "=== 3. 直近の取り込み結果 (dataset_ingest) ==="
  print_dataset_ingest_logs 10

  echo ""
  echo "=== 4. DNS 名前解決 (${DOMAIN}) ==="
  dig "${DOMAIN}" A +short

  echo ""
  echo "=== 5. SSL 証明書の状態 (houjin-bangou-ssl-cert) ==="
  gcloud compute ssl-certificates describe houjin-bangou-ssl-cert \
    --project="${PROJECT_ID}" \
    --global \
    --format="table(name,managed.status,managed.domainStatus)"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage >&2
    exit 1
  fi

  local subcommand="$1"
  shift

  case "${subcommand}" in
    preflight)
      if [[ $# -ne 0 ]]; then
        usage >&2
        fail "preflight に引数は不要です。"
      fi
      cmd_preflight
      ;;
    release)
      if [[ $# -ne 0 ]]; then
        usage >&2
        fail "release に引数は不要です。"
      fi
      cmd_release
      ;;
    ingest)
      cmd_ingest "$@"
      ;;
    status)
      if [[ $# -ne 0 ]]; then
        usage >&2
        fail "status に引数は不要です。"
      fi
      cmd_status
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      fail "不明なサブコマンドです: ${subcommand}"
      ;;
  esac
}

main "$@"
