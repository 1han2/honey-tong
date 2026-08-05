import { Composition } from "remotion";
import { ShortsComposition } from "./ShortsComposition.js";
import type { ShortsRenderProps } from "./types.js";
import { totalFrames } from "./types.js";

const defaultProps: ShortsRenderProps = {
  title: "Shorts",
  hookTitle: "연예인이 선택한\n이 제품의 정체",
  productName: "Product",
  segments: [
    {
      type: "narration",
      fileName: "placeholder.mp3",
      durationMs: 1_000,
      text: "Preview",
    },
  ],
};

export const RemotionRoot = () => (
  <Composition
    id="AffiliateShorts"
    component={ShortsComposition}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props, 30),
    })}
  />
);
