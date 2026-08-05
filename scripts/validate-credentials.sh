#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "${ENV_FILE}" "${RESPONSE_FILE}"' EXIT

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  sed -E 's/^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*/\1=/' "${PROJECT_DIR}/.env" > "${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN in .env or the environment}"
GEMINI_PROVIDER="${GEMINI_PROVIDER:-api}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.6-flash}"
GEMINI_LOCATION="${GEMINI_LOCATION:-global}"
GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"

telegram_http_code="$(curl --silent --show-error --output "${RESPONSE_FILE}" --write-out '%{http_code}' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe")"
if [[ "${telegram_http_code}" != "200" ]] || ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "${RESPONSE_FILE}"; then
  echo "Telegram Bot Token validation failed (HTTP ${telegram_http_code})." >&2
  exit 1
fi

if [[ "${GEMINI_PROVIDER}" == "vertex" ]]; then
  : "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT for Vertex AI}"
  gcloud auth print-access-token >/dev/null
  if ! gcloud services list --enabled --project="${GOOGLE_CLOUD_PROJECT}" \
    --filter='config.name=aiplatform.googleapis.com' --format='value(config.name)' | grep -qx 'aiplatform.googleapis.com'; then
    echo "Vertex AI API is not enabled in ${GOOGLE_CLOUD_PROJECT}." >&2
    exit 1
  fi
  gemini_http_code=200
else
  : "${GEMINI_API_KEY:?Set GEMINI_API_KEY in .env or the environment}"
  gemini_http_code="$(curl --silent --show-error --output "${RESPONSE_FILE}" --write-out '%{http_code}' \
    --header "x-goog-api-key: ${GEMINI_API_KEY}" \
    "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}")"
fi
if [[ "${gemini_http_code}" != "200" ]]; then
  echo "Gemini API key/model validation failed for ${GEMINI_MODEL} (HTTP ${gemini_http_code})." >&2
  exit 1
fi

echo "Telegram Bot Token: valid"
echo "Gemini ${GEMINI_PROVIDER} ${GEMINI_MODEL}: valid"
