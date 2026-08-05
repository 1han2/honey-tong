#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
: "${TELEGRAM_CHAT_ID:?Set TELEGRAM_CHAT_ID}"

REGION="${GOOGLE_CLOUD_REGION:-asia-northeast3}"
REPOSITORY="${ARTIFACT_REPOSITORY:-shorts}"
MEDIA_BUCKET="${MEDIA_BUCKET:-${GOOGLE_CLOUD_PROJECT}-shorts-media}"
SCAN_SCHEDULE="${SCAN_SCHEDULE:-0 18 * * *}"

SCAN_TIME_ZONE="${SCAN_TIME_ZONE:-Asia/Seoul}"
IMAGE_TAG="${IMAGE_TAG:-manual-$(date +%Y%m%d%H%M%S)}"
API_SA="shorts-api-sa@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
JOB_SA="shorts-job-sa@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
SCHEDULER_SA="shorts-scheduler-sa@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
API_IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${REPOSITORY}/shorts-api:${IMAGE_TAG}"
JOB_IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${REPOSITORY}/shorts-job:${IMAGE_TAG}"

gcloud config set project "${GOOGLE_CLOUD_PROJECT}"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  iamcredentials.googleapis.com \
  run.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  texttospeech.googleapis.com \
  cloudscheduler.googleapis.com

if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  FIRESTORE_LOCATION="$(gcloud firestore databases describe --database='(default)' --format='value(locationId)')"
  if [[ -n "${FIRESTORE_LOCATION}" && "${FIRESTORE_LOCATION}" != "${REGION}" ]]; then
    echo "Warning: existing Firestore location is ${FIRESTORE_LOCATION}, not ${REGION}." >&2
  fi
else
  gcloud firestore databases create --database='(default)' \
    --location="${REGION}" --type=firestore-native
fi

GEMINI_PROVIDER="${GEMINI_PROVIDER:-api}"
REQUIRED_SECRETS=(telegram-bot-token telegram-webhook-secret)
if [[ "${GEMINI_PROVIDER}" == "api" ]]; then
  REQUIRED_SECRETS+=(gemini-api-key)
fi
for secret in "${REQUIRED_SECRETS[@]}"; do
  gcloud secrets describe "${secret}" >/dev/null 2>&1 \
    || { echo "Missing Secret Manager secret: ${secret}" >&2; exit 1; }
done

gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "${REPOSITORY}" --repository-format=docker --location="${REGION}"

for account in shorts-api-sa shorts-job-sa shorts-scheduler-sa; do
  gcloud iam service-accounts describe "${account}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "${account}"
done

for account in "${API_SA}" "${JOB_SA}"; do
  gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
    --member="serviceAccount:${account}" --role=roles/datastore.user >/dev/null
  gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
    --member="serviceAccount:${account}" --role=roles/secretmanager.secretAccessor >/dev/null
  gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
    --member="serviceAccount:${account}" --role=roles/aiplatform.user >/dev/null
done
gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
  --member="serviceAccount:${API_SA}" --role=roles/run.jobsExecutorWithOverrides >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${JOB_SA}" \
  --member="serviceAccount:${JOB_SA}" --role=roles/iam.serviceAccountTokenCreator >/dev/null

gcloud storage buckets describe "gs://${MEDIA_BUCKET}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${MEDIA_BUCKET}" \
    --location="${REGION}" --default-storage-class=STANDARD --uniform-bucket-level-access
BUCKET_LOCATION="$(gcloud storage buckets describe "gs://${MEDIA_BUCKET}" --format='value(location)')"
BUCKET_LOCATION_NORMALIZED="$(printf '%s' "${BUCKET_LOCATION}" | tr '[:upper:]' '[:lower:]')"
REGION_NORMALIZED="$(printf '%s' "${REGION}" | tr '[:upper:]' '[:lower:]')"
if [[ -n "${BUCKET_LOCATION}" && "${BUCKET_LOCATION_NORMALIZED}" != "${REGION_NORMALIZED}" ]]; then
  echo "Bucket ${MEDIA_BUCKET} is in ${BUCKET_LOCATION}, expected ${REGION}." >&2
  exit 1
fi
gcloud storage buckets update "gs://${MEDIA_BUCKET}" \
  --clear-soft-delete --no-versioning --lifecycle-file=infra/gcs-lifecycle.json
gcloud storage buckets add-iam-policy-binding "gs://${MEDIA_BUCKET}" \
  --member="serviceAccount:${JOB_SA}" --role=roles/storage.objectAdmin >/dev/null

gcloud builds submit --config=cloudbuild.yaml \
  --substitutions="_REGION=${REGION},_REPOSITORY=${REPOSITORY},_IMAGE_TAG=${IMAGE_TAG}" .

GEMINI_PROVIDER="${GEMINI_PROVIDER:-api}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash-lite}"
GEMINI_SCRIPT_MODEL="${GEMINI_SCRIPT_MODEL:-gemini-3.5-flash}"
GEMINI_LOCATION="${GEMINI_LOCATION:-global}"
GEMINI_MEDIA_RESOLUTION="${GEMINI_MEDIA_RESOLUTION:-MEDIA_RESOLUTION_LOW}"
GEMINI_TIMEOUT_MS="${GEMINI_TIMEOUT_MS:-180000}"
SCAN_LOOKBACK_HOURS="${SCAN_LOOKBACK_HOURS:-24}"
COMMON_ENV="GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},GOOGLE_CLOUD_REGION=${REGION},FIRESTORE_DATABASE_ID=(default),MEDIA_BUCKET=${MEDIA_BUCKET},TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID},GEMINI_PROVIDER=${GEMINI_PROVIDER},GEMINI_MODEL=${GEMINI_MODEL},GEMINI_SCRIPT_MODEL=${GEMINI_SCRIPT_MODEL},GEMINI_LOCATION=${GEMINI_LOCATION},GEMINI_MEDIA_RESOLUTION=${GEMINI_MEDIA_RESOLUTION},GEMINI_TIMEOUT_MS=${GEMINI_TIMEOUT_MS},SCAN_LOOKBACK_HOURS=${SCAN_LOOKBACK_HOURS}"
JOB_SECRETS="TELEGRAM_BOT_TOKEN=telegram-bot-token:latest"
if [[ "${GEMINI_PROVIDER}" == "api" ]]; then
  JOB_SECRETS+=",GEMINI_API_KEY=gemini-api-key:latest"
fi
API_SECRETS="TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_WEBHOOK_SECRET=telegram-webhook-secret:latest"

gcloud run jobs deploy shorts-scan \
  --image="${JOB_IMAGE}" --region="${REGION}" --service-account="${JOB_SA}" \
  --args=scan \
  --cpu=1 --memory=1Gi --max-retries=1 --task-timeout=30m \
  --set-env-vars="${COMMON_ENV}" --set-secrets="${JOB_SECRETS}"

gcloud run jobs deploy shorts-produce \
  --image="${JOB_IMAGE}" --region="${REGION}" --service-account="${JOB_SA}" \
  --args=produce \
  --cpu=4 --memory=8Gi --max-retries=1 --task-timeout=30m \
  --add-volume=name=render-tmp,type=in-memory,size-limit=3Gi \
  --add-volume-mount=volume=render-tmp,mount-path=/mnt/render-tmp \
  --set-env-vars="${COMMON_ENV},TMPDIR=/mnt/render-tmp" --set-secrets="${JOB_SECRETS}"

gcloud run jobs execute shorts-scan --region="${REGION}" \
  --args=import-channels,--apply --wait

gcloud run deploy shorts-api \
  --image="${API_IMAGE}" --region="${REGION}" --service-account="${API_SA}" \
  --allow-unauthenticated --min=0 --max-instances=2 --cpu=1 --memory=512Mi --port=8080 \
  --set-env-vars="${COMMON_ENV},PRODUCE_JOB_NAME=shorts-produce" \
  --set-secrets="${API_SECRETS}"

SCAN_URI="https://run.googleapis.com/v2/projects/${GOOGLE_CLOUD_PROJECT}/locations/${REGION}/jobs/shorts-scan:run"
gcloud run jobs add-iam-policy-binding shorts-scan --region="${REGION}" \
  --member="serviceAccount:${SCHEDULER_SA}" --role=roles/run.invoker >/dev/null
gcloud scheduler jobs describe shorts-scan --location="${REGION}" >/dev/null 2>&1 \
  && gcloud scheduler jobs update http shorts-scan --location="${REGION}" \
    --schedule="${SCAN_SCHEDULE}" --time-zone="${SCAN_TIME_ZONE}" --uri="${SCAN_URI}" --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SA}" \
  || gcloud scheduler jobs create http shorts-scan --location="${REGION}" \
    --schedule="${SCAN_SCHEDULE}" --time-zone="${SCAN_TIME_ZONE}" --uri="${SCAN_URI}" --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SA}"

echo "Deployment complete. Run scripts/set-telegram-webhook.sh after secrets are populated."
