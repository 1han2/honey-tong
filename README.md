# Celebrity Affiliate Shorts

연예인 YouTube 채널을 RSS로 모니터링하고, Gemini가 영상·음성·화면을 직접 분석해 상품 후보를 찾은 뒤 Telegram 승인 하나로 대본, TTS, Remotion Shorts까지 만드는 저비용 파이프라인이다.

## 현재 구조

```text
Cloud Scheduler (매일 18:00 Asia/Seoul)

  → Cloud Run Job: shorts-scan
  → YouTube RSS (404/5xx 시 공개 browse fallback) + YouTube duration metadata only + Gemini video understanding
  → Firestore candidates
  → Telegram 승인 버튼
  → Cloud Run Service: shorts-api
  → Cloud Run Job: shorts-produce
  → Gemini 대본 + Cloud TTS + GCS + FFmpeg + Remotion
  → Telegram GCS Signed URL 검수
```

월별 Google Sheet나 행 번호는 사용하지 않는다.

- `videos/{videoId}`: YouTube `videoId`가 문서 ID
- `candidates/{candidateId}`: `videoId + 정규화된 제품명 SHA-256 앞 20자리`
- 같은 영상과 제품을 다시 분석해도 같은 candidate 문서 사용
- 이미 처리한 영상의 `video` 문서는 전체 시청 이력이 아니라 재분석 방지용 최소 메타데이터와 candidate의 원본 영상 연결용으로만 유지한다.
- 일일 배치 기준으로 최근 24시간 내 RSS/browse 영상만 분석한다. 배치 지연이나 장애 복구가 필요하면 `SCAN_LOOKBACK_HOURS`만 늘린다.
- RSS가 404/5xx이면 YouTube 공개 `youtubei/v1/browse` 응답에서 최신 영상 ID·제목·상대 게시일을 읽는다. YouTube Data API 키나 별도 유료 수집 서비스는 사용하지 않는다.
- 후보 탐색 중 영상 파일은 다운로드하지 않으며, 타임스탬프 검증을 위해 watch page의 길이 메타데이터만 조회

## 로컬 요구사항

- Node.js 22 이상
- pnpm 11 이상
- 실제 source clip 처리에는 `ffmpeg`, `ffprobe`
- GCP 연결 시 Application Default Credentials

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
pnpm test:render
pnpm test:media
```

`pnpm test:render`는 외부 영상이나 GCP 없이 10초짜리 Remotion MP4를 `out/fixture.mp4`에 만든다. `pnpm test:media`는 FFmpeg로 테스트 원본을 만들고 실제 컷 추출 후 Remotion으로 합쳐 해상도·프레임률·코덱·길이를 검증한다.

## 채널 DB

기본 입력은 `db/연예인_채널_DB_20260727_channel_id.xlsx`다.

```bash
# Firestore에 쓰지 않는 검증
pnpm import:channels

# Application Default Credentials가 설정된 환경에서 실제 반영
pnpm import:channels -- --apply
```

현재 파일은 163행 중 161개가 유효하다. 오연서와 차예련 행은 YouTube Channel ID가 없어 경고 후 제외된다.

## 환경변수와 비밀값

일반 설정은 `.env.example`을 참고한다. 운영 비밀값은 코드나 `.env`를 이미지에 포함하지 않고 Secret Manager에 둔다.

- `telegram-bot-token`
- `telegram-webhook-secret`
- `gemini-api-key` (Gemini AI Studio `api` provider일 때만 필요; Vertex AI provider는 생략 가능)

Legacy Apps Script에 노출된 Telegram Bot Token은 반드시 BotFather에서 폐기하고 새 토큰을 사용한다.

```bash
export GOOGLE_CLOUD_PROJECT="..."
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_WEBHOOK_SECRET="..."
# GEMINI_PROVIDER=api일 때만 필요. Vertex AI를 쓰면 생략 가능.
export GEMINI_PROVIDER="vertex"
./scripts/create-secrets.sh
```

## 배포

처음 배포할 때는 `.env`에 프로젝트·chat ID·provider 설정을 입력한 뒤 아래 한 번으로 Secret 등록, GCP 리소스 배포, Telegram webhook 설정까지 수행한다. `GEMINI_PROVIDER=vertex`이면 Vertex ADC/IAM만 사용하고 AI Studio 키 Secret을 요구하지 않는다. `TELEGRAM_WEBHOOK_SECRET`을 지정하지 않으면 안전한 임의값을 생성해 Secret Manager와 Telegram에 동일하게 설정한다.

```bash
cp .env.example .env
# .env에 GOOGLE_CLOUD_PROJECT, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, GEMINI_PROVIDER 입력
./scripts/validate-credentials.sh
./scripts/bootstrap.sh
```

Billing 없이 Gemini 영상 이해 API만 확인하려면 다음을 실행한다. 기본값은 Gemini 공식 영상 이해 예제 URL이며, 실제 테스트 URL은 `GEMINI_TEST_VIDEO_URL`로 바꿀 수 있다.

```bash
pnpm test:gemini
```

Gemini API key 프로젝트의 선불 크레딧이 소진된 경우 실제 분석 호출은 `RESOURCE_EXHAUSTED`로 종료된다. 이 경우 AI Studio에서 해당 프로젝트의 결제·크레딧을 보충한 뒤 다시 실행한다.

비밀값을 셸 history에 직접 쓰지 말고 `.env`에만 입력한다. `.env`는 gitignore 대상이다. 개별 배포나 복구가 필요할 때만 아래 스크립트를 따로 사용한다.

Billing 계정이 없는 프로젝트는 먼저 Google Cloud Console에서 Billing 계정을 만든 뒤 `honeytong` 프로젝트에 연결해야 한다. 계정 ID를 알고 있다면 다음 명령으로 연결할 수 있다.

```bash
gcloud billing projects link honeytong --billing-account=BILLING_ACCOUNT_ID
```

`scripts/deploy.sh`는 다음을 생성하거나 갱신한다.

- Artifact Registry repository 1개
- Firestore default database
- GCS Standard 임시 버킷 1개
- Cloud Run Service `shorts-api`
- Cloud Run Jobs `shorts-scan`, `shorts-produce`
- Cloud Scheduler `shorts-scan`
- 최소 역할의 서비스 계정 3개
- GCS lifecycle, soft delete 비활성화, versioning 비활성화
- 채널 DB 161개 초기 import

```bash
export GOOGLE_CLOUD_PROJECT="..."
export TELEGRAM_CHAT_ID="..."
./scripts/deploy.sh
```

배포 후 출력된 `shorts-api` URL로 webhook을 설정한다.

```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_WEBHOOK_SECRET="..."
export PUBLIC_API_URL="https://shorts-api-....run.app"
./scripts/set-telegram-webhook.sh
```

## 원본 영상 등록

Gemini 분석은 공개 YouTube URL을 직접 사용한다. 렌더 단계는 별개이며 현재 구현은 권리가 확인된 직접 다운로드 가능한 `video/*` URL만 받는다. YouTube watch page URL은 미디어 원본 URL이 아니다.

후보가 `SOURCE_REQUIRED`일 때 다음 명령으로 source를 등록하면 기본적으로 `shorts-produce` Job도 다시 시작한다.

```bash
pnpm register:source -- \
  --candidate-id="..." \
  --video-id="..." \
  --source-url="https://authorized.example.com/source.mp4"
```

등록만 하고 Job을 시작하지 않으려면 `--no-start`를 추가한다.

## 미디어 보관

```text
source/{candidateId}/...  성공 직후 삭제, lifecycle 2일
tts/{candidateId}/...     성공 직후 삭제, lifecycle 2일
output/{candidateId}/...  lifecycle 14일
```

버킷은 비공개이며 Telegram에는 7일짜리 V4 Signed URL만 보낸다. 대본과 편집 계획은 영상 파일과 별개로 Firestore candidate 문서에 유지된다.

## 영상 템플릿

현재 `remotion/ShortsComposition.tsx`는 파이프라인 검증용 기본 템플릿이다.

- 1080x1920, 30fps
- source clip center crop
- 실제 발언 자막
- 나레이션 구간의 임시 텍스트 화면과 TTS

렌더 전에는 권리 확인 direct source의 실제 길이를 `ffprobe`로 확인한다. Gemini 편집 계획의 clip 범위가 source 길이를 넘으면 렌더하지 않고 candidate를 실패 처리한다.

최종 레이아웃, 폰트, 색상, 자막 모션은 이 Composition만 교체해서 확정한다.
