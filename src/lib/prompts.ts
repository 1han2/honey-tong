import fs from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { loadConfig } from "../config.js";
import { logger } from "./logger.js";
import { errorMessage } from "./errors.js";

const promptCache = new Map<string, string>();

const loadPromptFile = async (fileName: string): Promise<string> => {
  const cached = promptCache.get(fileName);
  if (cached) return cached;

  try {
    const config = loadConfig();
    if (config.MEDIA_BUCKET) {
      const storage = new Storage({
        ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
      });
      const file = storage.bucket(config.MEDIA_BUCKET).file(`prompts/${fileName}`);
      const [exists] = await file.exists();
      if (exists) {
        const [content] = await file.download();
        const prompt = content.toString("utf8");
        promptCache.set(fileName, prompt);
        logger.info({ fileName }, "Successfully loaded prompt from GCS");
        return prompt;
      }
    }
  } catch (error) {
    logger.warn(
      { fileName, error: errorMessage(error) },
      "Failed to load prompt from GCS, falling back to local file",
    );
  }

  const promptPath = path.resolve(process.env.PROMPT_DIR ?? "base_prompt", fileName);
  const prompt = await fs.readFile(promptPath, "utf8");
  promptCache.set(fileName, prompt);
  return prompt;
};


export const getProductsPrompt = async (
  expectedVideoId?: string,
  videoDurationMs?: number | null,
): Promise<string> => {
  const base = await loadPromptFile("get_products.md");
  const idClause = expectedVideoId ? `(${expectedVideoId})` : "";
  const minutes = videoDurationMs ? Math.floor(videoDurationMs / 60_000) : 0;
  const seconds = videoDurationMs ? Math.floor((videoDurationMs % 60_000) / 1_000) : 0;
  const durationClause =
    videoDurationMs && videoDurationMs > 0
      ? `\n- 영상 전체 길이는 ${minutes}분 ${seconds}초 (${videoDurationMs}ms)다. 모든 evidence.startMs는 반드시 0 이상 ${videoDurationMs - 1}ms 이하의 정수이어야 하며, ${videoDurationMs}ms를 절대로 초과할 수 없다.`
      : "";
  return `${base}\n\n[API JSON 출력 계약 — 절대 준수]\n- 표나 Markdown을 출력하지 말고 JSON 객체 하나만 출력한다. 최상위 형식은 반드시 {"products":[...]}이다.\n- 각 제품 키는 정확히 productName, productNameRaw, brand, category, evidence를 사용한다. snake_case(product_name 등)를 사용하지 않는다.\n- evidence의 각 키는 정확히 videoId, startMs, quote, kind를 사용한다. endMs는 절대 입력하지 않는다.\n- evidence.videoId는 반드시 분석 입력 영상의 YouTube ID${idClause}를 그대로 쓴다. URL, 채널 ID, null을 쓰지 않는다.\n- evidence.startMs 산식: (분 × 60 + 초) × 1000. 예: 2분 10초 ➔ 130,000ms. (⚠️ 2분 10초를 210,000ms로 잘못 쓰지 마라!)\n- 실제 발언이면 kind="quote"이고 quote에는 원문만 쓴다.\n- 발언이 없고 화면으로만 식별했으면 kind="scene"이고 quote는 반드시 "[장면]"으로 시작한다.\n- 1개 제품당 evidence는 시연/먹방 리액션, 사용 후기 발화, 명확한 등장 장면을 포함해 최대 3개까지 작성한다.\n- 인물 이름(출연자·게스트), 장소·도시·식당·카페·호텔·리조트·관광지명, 방송 제목·해시태그·감정 표현은 상품이 아니므로 products에 절대 넣지 않는다.\n- 서비스(마사지, 네일, PT, 헤어 등)는 온라인 구매 불가이므로 products에 넣지 않는다.\n- 오프라인 매장에서만 구매 가능한 현장 전용 메뉴·음식은 넣지 않는다.\n- 쿠팡·네이버쇼핑·11번가 등 온라인 쇼핑몰에서 검색·구매 가능한 실물 상품만 넣는다.\n- 출연자가 전혀 언급·설명하지 않고 화면에 스쳐 지나가기만 하는 제품은 넣지 않는다.\n- 확신할 수 없는 상품은 넣지 않는다.${durationClause}`;

};


export const makeTranscriptPrompt = async (): Promise<string> => {
  const base = await loadPromptFile("make_transcript.md");
  return `${base}

[API JSON 출력 계약 — 절대 준수]
- Markdown이나 설명을 출력하지 말고 제공된 JSON Schema만 출력한다.
- title은 내부 식별용 짧은 제목이다.
- hookTitle은 영상 상단에 표시할 후킹 제목이다. 각 줄당 5~8자 이내로 극도로 임팩트 있고 짧게 작성한다 (반드시 2줄 이내, 실제 개행 문자로 줄바꿈).
- ⚠️ hookTitle 작성 규칙: 첫 줄에는 상황에 맞게 연예인/출연자 이름, 추천 주체 또는 핵심 키워드(기간/효과)를 자유롭게 활용하라 (예: "이국주 찐애정템", "10년째 내돈내산", "의사가 강추한", "최애 꿀템"). 연예인 이름을 무조건 강제로 쓸 필요는 없으며, 영상의 실제 발언자와 상황에 맞게 시선을 끄는 표현을 사용한다. 둘째 줄에는 궁금증을 유도하는 짧은 문구를 써라 (예: "대체 뭐길래?", "이건 못참지", "난리난 이유").
- hookTitle은 과장된 의학적 효능이나 확인되지 않은 사실을 단정하지 않는다.
- scriptText에는 전체 대본을 사람이 읽을 수 있는 문자열로 넣는다.
- segments는 narration 또는 source_clip 배열이다.
- ⚠️ 나레이션 최소화: narration은 징검다리일 뿐이며 최소화되어야 합니다 (영상 전체에 1~3회 내외). 연예인 발언(source_clip)이 연속해서(2~3회 연속) 들리도록 배치하고, 나레이션과 번갈아 번잡하게 오가는 교차 배치를 금지합니다.
- narration의 text는 절대로 2문장 이상을 합쳐 쓰지 말고 1문장(15자 이내) 단위로 극도로 짧게 나누어 작성하십시오.
- ⚠️ 나레이션 명사형 종결 절대 금지 (초강력 규칙): 나레이션 문장은 절대로 명사나 명사구(예: "감자칩", "아이템", "애정템" 등)로 단정 지으며 끝나서는 안 되며, 반드시 "~라는데", "~나 봄", "~인 듯", "~라고 하네요" 등 자연스러운 서술형 종결 어미로 끝나야 합니다. (예: "이지혜 픽 감자칩" X ➔ "이지혜가 픽한 감자칩이라는데" O)
- ⚠️ 기승전결 및 마무리 여운: 흐름이 갑자기 끊어져 "잉?" 하고 허무하게 끝나지 않도록 기승전결(도입-전개-위트/클라이맥스-여운 마무리)을 확실히 갖추어야 합니다. 특히 마지막 세그먼트는 연예인의 웃음소리, 위트 있는 소회 멘트, 혹은 자연스러운 마무리 멘트(source_clip) 등으로 깔끔하고 여운 있게 끝맺음하십시오.
- 영상 전체에서 연예인의 실제 발언(source_clip) 비중이 75% 이상(총 4~6개 이상 대사 클립 확보)으로 구성되어 풍성한 분량(20~35초 내외)을 확보해야 합니다.
- ⚠️ source_clip 선정 필수 규칙: source_clip은 반드시 입력된 승인 [제품/아이템]과 직접 관련된 발언·먹방·시연·리액션 구간이어야 합니다. 핸드폰/문자 이야기나 제품과 무관한 엉뚱한 잡담을 source_clip으로 선택하지 마십시오.
- [제품 근거 JSON]에 적힌 타임스탬프 부근(출연자가 해당 제품을 먹거나 사용/언급하는 부근)을 참고하여 제품과 관련된 3~6초 진짜 음성 타임스탬프(sourceStartMs~sourceEndMs)를 직접 정밀 추출하십시오.
- sourceEndMs는 sourceStartMs보다 반드시 커야 하며, 자막(subtitle) 문장 끝에는 마침표(.)를 붙이지 않습니다.`;
};
