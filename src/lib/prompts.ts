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
  return `${base}\n\n[API JSON 출력 계약 — 절대 준수]\n- 표나 Markdown을 출력하지 말고 JSON 객체 하나만 출력한다. 최상위 형식은 반드시 {"products":[...]}이다.\n- 각 제품 키는 정확히 productName, productNameRaw, brand, category, evidence를 사용한다. snake_case(product_name 등)를 사용하지 않는다.\n- evidence의 각 키는 정확히 videoId, startMs, quote, kind를 사용한다. endMs는 절대 입력하지 않는다.\n- evidence.videoId는 반드시 분석 입력 영상의 YouTube ID${idClause}를 그대로 쓴다. URL, 채널 ID, null을 쓰지 않는다.\n- evidence.startMs 산식: (분 × 60 + 초) × 1000. 예: 2분 10초 ➔ 130,000ms. (⚠️ 2분 10초를 210,000ms로 잘못 쓰지 마라!)\n- 실제 발언이면 kind="quote"이고 quote에는 원문만 쓴다.\n- 발언이 없고 화면으로만 식별했으면 kind="scene"이고 quote는 반드시 "[장면]"으로 시작한다.\n- 1개 제품당 evidence는 가장 대표적인 장면 1개만 작성한다.\n- 인물 이름(출연자·게스트), 장소·도시·식당·카페·호텔·리조트·관광지명, 방송 제목·해시태그·감정 표현은 상품이 아니므로 products에 절대 넣지 않는다.\n- 서비스(마사지, 네일, PT, 헤어 등)는 온라인 구매 불가이므로 products에 넣지 않는다.\n- 오프라인 매장에서만 구매 가능한 현장 전용 메뉴·음식은 넣지 않는다.\n- 쿠팡·네이버쇼핑·11번가 등 온라인 쇼핑몰에서 검색·구매 가능한 실물 상품만 넣는다.\n- 출연자가 전혀 언급·설명하지 않고 화면에 스쳐 지나가기만 하는 제품은 넣지 않는다.\n- 확신할 수 없는 상품은 넣지 않는다.${durationClause}`;

};


export const makeTranscriptPrompt = async (): Promise<string> => {
  const base = await loadPromptFile("make_transcript.md");
  return `${base}\n\n[API JSON 출력 계약 — 절대 준수]\n- Markdown이나 설명을 출력하지 말고 제공된 JSON Schema만 출력한다.\n- title은 내부 식별용 짧은 제목이다.\n- hookTitle은 영상 상단에 표시할 후킹 제목이다. 반드시 2줄 이내로 만들고 줄바꿈은 실제 개행 문자로 넣는다. 첫 줄에는 인물/기간/핵심 키워드처럼 시선을 끄는 짧은 문구를, 둘째 줄에는 궁금증을 만드는 문구를 쓴다.\n- hookTitle은 과장된 의학적 효능이나 확인되지 않은 사실을 단정하지 않는다.\n- scriptText에는 전체 대본을 사람이 읽을 수 있는 문자열로 넣는다.\n- segments는 narration 또는 source_clip 배열이다.\n- narration에는 text만 넣으며, 나레이션은 최소화하여 1문장 이내의 짧은 징검다리 역할만 수행한다.\n- 영상 전체에서 연예인의 실제 발언(source_clip) 비중이 60% 이상이어야 한다.\n- source_clip의 sourceStartMs/sourceEndMs는 출연자가 발언을 시작해서 완전히 마칠 때까지의 정확한 전체 구간(최소 3~6초)이어야 한다. 중간에 발언이 잘리지 않도록 정확하게 잡는다.\n- source_clip.subtitle은 해당 구간에서 실제 들리는 발언 원문과 100% 일치해야 하며, 문장 끝에 마침표(.)를 붙이지 않는다.\n- sourceEndMs는 sourceStartMs보다 반드시 커야 한다.`;
};
