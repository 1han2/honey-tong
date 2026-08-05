# 연예인 YouTube Affiliate Shorts 자동 제작 시스템 인수인계 문서 (HANDOFF)

- **작성일자**: 2026-08-05
- **프로젝트명**: `celebrity-affiliate-shorts`
- **현재 단계**: MVP 파이프라인 개발 및 로컬/GCP 검증 완료 (`shorts-api`, `shorts-scan`, `shorts-produce` GCP Cloud Run 배포 완료, 합성 원본 E2E 테스트 성공, 권리 확인된 실제 원본 대기 중)

---

## 1. 현재 상태 요약

1. **문서 및 코드 일치 상태**:
   - `WORK_PLAN.md` 및 `README.md` 기준 파이프라인(Phase 0~Phase 5)의 코드는 모두 작성되어 있습니다.
   - `pnpm typecheck`, `pnpm test` (12개 파일, 37개 테스트 통과), `pnpm build` (`tsc`), `pnpm test:render` (10초 fixture Remotion MP4 렌더), `pnpm test:media` (FFmpeg 실파일 컷 추출 후 Remotion 1080x1920 30fps H.264/AAC 통합 렌더 및 ffprobe 검증) 모두 정상 통과합니다.
   - **Shorts 전용 제외 기능 추가**: `EXCLUDE_SHORTS=true` (기본값) 및 `MIN_LONG_FORM_SECONDS=60` 설정을 통해 60초 이하 숏폼 및 `#shorts`/`#쇼츠` 영상 자동 필터링 적용.


2. **운영 배포 상태**:
   - GCP Project: `honeytong` (Asia-Northeast3 / Seoul)
   - `shorts-api` (Cloud Run Service): Telegram Webhook 핸들러 및 승인 API (`/telegram/webhook`, `/health`)
   - `shorts-scan` (Cloud Run Job): 매일 18:00 (Asia/Seoul) YouTube RSS 모니터링 + Vertex AI Gemini 영상 분석 + Telegram 후보 알림

   - `shorts-produce` (Cloud Run Job): Telegram 승인 후 Gemini 대본/편집계획 재분석 + Cloud TTS + Remotion 렌더 + GCS Signed URL 알림
   - GCS Bucket: `source/`, `tts/`, `output/` 임시 미디어 보관 (lifecycle 자동 삭제)

---

## 2. 코어 데이터 흐름 및 명령어 정리

### 2.1 개발 및 테스트 명령
```bash
# 환경 설정
cp .env.example .env

# TypeScript 타입 검사
pnpm typecheck

# 단위 테스트 (Vitest 35개)
pnpm test

# 프로젝트 빌드 (tsc)
pnpm build

# Remotion 기본 렌더 검증 (out/fixture.mp4 생성)
pnpm test:render

# FFmpeg + Remotion 통합 미디어 파이프라인 검증 (out/media-pipeline/pipeline.mp4)
pnpm test:media
```

### 2.2 원본 소스 등록 명령
후보 상태가 `SOURCE_REQUIRED`인 경우, 권리 확인된 미디어 URL을 등록하여 `shorts-produce` Job을 다시 시작시킵니다.
```bash
pnpm register:source -- \
  --candidate-id="<CANDIDATE_ID>" \
  --video-id="<VIDEO_ID>" \
  --source-url="https://authorized.example.com/source.mp4"
```

---

## 3. 남은 매뉴얼/운영 작업 체크리스트

- [ ] **Telegram Bot Token 보안 조치**: 기존 노출된 토큰이 있다면 BotFather에서 폐기 후 재발급하고 `Secret Manager` (`telegram-bot-token`) 업데이트
- [ ] **Legacy Apps Script trigger 종료**: 이전 시스템의 구형 스크립트 트리거 중단
- [ ] **실제 권리 확인 원본 E2E 운영 렌더**: 외부 권리가 확보된 원본 MP4 URL을 연결하여 정식 운영 렌더 수행

---

## 4. 관련 주요 파일

- `WORK_PLAN.md`: 전체 마일스톤 및 세부 변경 이력
- `README.md`: 프로젝트 개요 및 명령 모음
- `HANDOFF.md`: 본 인수인계 문서
- `src/services/scan-service.ts`: RSS 수집 및 Gemini 분석 로직
- `src/services/produce-service.ts`: 승인 및 Gemini 대본 생성, TTS, 렌더 서비스
- `src/services/media-production-service.ts`: GCS 스트리밍, FFmpeg 컷 편집, Remotion 렌더 파이프라인
- `remotion/ShortsComposition.tsx`: Shorts 템플릿 (1080x1920, 30fps, 상단 hookTitle, 중앙 1:1 Crop, 하단 자막)
