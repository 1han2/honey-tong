#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ -f "${PROJECT_DIR}/.env" ]]; then
  EXISTING_GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
  EXISTING_GOOGLE_CLOUD_REGION="${GOOGLE_CLOUD_REGION:-}"
  EXISTING_TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
  EXISTING_TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
  EXISTING_TELEGRAM_WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-}"
  EXISTING_GEMINI_API_KEY="${GEMINI_API_KEY:-}"
  NORMALIZED_ENV_FILE="$(mktemp)"
  trap 'rm -f "${NORMALIZED_ENV_FILE}"' EXIT
  sed -E 's/^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*/\1=/' "${PROJECT_DIR}/.env" > "${NORMALIZED_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${NORMALIZED_ENV_FILE}"
  set +a
  [[ -n "${EXISTING_GOOGLE_CLOUD_PROJECT}" ]] && export GOOGLE_CLOUD_PROJECT="${EXISTING_GOOGLE_CLOUD_PROJECT}"
  [[ -n "${EXISTING_GOOGLE_CLOUD_REGION}" ]] && export GOOGLE_CLOUD_REGION="${EXISTING_GOOGLE_CLOUD_REGION}"
  [[ -n "${EXISTING_TELEGRAM_BOT_TOKEN}" ]] && export TELEGRAM_BOT_TOKEN="${EXISTING_TELEGRAM_BOT_TOKEN}"
  [[ -n "${EXISTING_TELEGRAM_CHAT_ID}" ]] && export TELEGRAM_CHAT_ID="${EXISTING_TELEGRAM_CHAT_ID}"
  [[ -n "${EXISTING_TELEGRAM_WEBHOOK_SECRET}" ]] && export TELEGRAM_WEBHOOK_SECRET="${EXISTING_TELEGRAM_WEBHOOK_SECRET}"
  [[ -n "${EXISTING_GEMINI_API_KEY}" ]] && export GEMINI_API_KEY="${EXISTING_GEMINI_API_KEY}"
fi

GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
GOOGLE_CLOUD_REGION="${GOOGLE_CLOUD_REGION:-asia-northeast3}"
export GOOGLE_CLOUD_PROJECT GOOGLE_CLOUD_REGION

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
: "${TELEGRAM_BOT_TOKEN:?Set the newly rotated TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_CHAT_ID:?Set TELEGRAM_CHAT_ID}"
GEMINI_PROVIDER="${GEMINI_PROVIDER:-api}"
if [[ "${GEMINI_PROVIDER}" == "api" ]]; then
  : "${GEMINI_API_KEY:?Set GEMINI_API_KEY when GEMINI_PROVIDER=api}"
fi

if [[ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]]; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

if [[ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"
fi
export TELEGRAM_WEBHOOK_SECRET

cd "${PROJECT_DIR}"

"${SCRIPT_DIR}/validate-credentials.sh"

BILLING_ENABLED="$(gcloud billing projects describe "${GOOGLE_CLOUD_PROJECT}" --format='value(billingEnabled)')"
if [[ "${BILLING_ENABLED}" != "True" ]]; then
  echo "Billing is not enabled for ${GOOGLE_CLOUD_PROJECT}. Link a billing account before bootstrap." >&2
  exit 1
fi

"${SCRIPT_DIR}/create-secrets.sh"
"${SCRIPT_DIR}/deploy.sh"

PUBLIC_API_URL="$(gcloud run services describe shorts-api \
  --region="${GOOGLE_CLOUD_REGION:-asia-northeast3}" \
  --format='value(status.url)')"
if [[ -z "${PUBLIC_API_URL}" ]]; then
  echo "Could not determine shorts-api URL" >&2
  exit 1
fi
export PUBLIC_API_URL
"${SCRIPT_DIR}/set-telegram-webhook.sh"

echo "Bootstrap complete: ${PUBLIC_API_URL}"
