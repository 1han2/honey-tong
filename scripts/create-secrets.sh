#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
: "${TELEGRAM_BOT_TOKEN:?Set the newly rotated TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_WEBHOOK_SECRET:?Set TELEGRAM_WEBHOOK_SECRET}"
GEMINI_PROVIDER="${GEMINI_PROVIDER:-api}"
if [[ "${GEMINI_PROVIDER}" == "api" ]]; then
  : "${GEMINI_API_KEY:?Set GEMINI_API_KEY when GEMINI_PROVIDER=api}"
fi

gcloud config set project "${GOOGLE_CLOUD_PROJECT}"
gcloud services enable secretmanager.googleapis.com

upsert_secret() {
  local name="$1"
  local value="$2"
  gcloud secrets describe "${name}" >/dev/null 2>&1 \
    || gcloud secrets create "${name}" --replication-policy=automatic
  printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=- >/dev/null
}

upsert_secret telegram-bot-token "${TELEGRAM_BOT_TOKEN}"
upsert_secret telegram-webhook-secret "${TELEGRAM_WEBHOOK_SECRET}"
if [[ "${GEMINI_PROVIDER}" == "api" || -n "${GEMINI_API_KEY:-}" ]]; then
  upsert_secret gemini-api-key "${GEMINI_API_KEY:-}"
fi

echo "Secret versions added."
