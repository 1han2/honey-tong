#!/usr/bin/env bash
set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_WEBHOOK_SECRET:?Set TELEGRAM_WEBHOOK_SECRET}"
: "${PUBLIC_API_URL:?Set PUBLIC_API_URL}"

curl --fail-with-body --silent --show-error \
  --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --header "content-type: application/json" \
  --data "{\"url\":\"${PUBLIC_API_URL}/telegram/webhook\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\",\"drop_pending_updates\":true,\"allowed_updates\":[\"callback_query\"]}"

echo
echo "Telegram webhook configured."
