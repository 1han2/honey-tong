export type RenderSourceSegment = {
  type: "source_clip";
  fileName: string;
  durationMs: number;
  subtitle: string;
};

export type RenderNarrationSegment = {
  type: "narration";
  fileName: string;
  videoFileName?: string | undefined;
  durationMs: number;
  text: string;
};

export type ShortsRenderProps = {
  title: string;
  hookTitle?: string;
  productName: string;
  segments: Array<RenderSourceSegment | RenderNarrationSegment>;
};

export const framesForDuration = (durationMs: number, fps: number): number =>
  Math.max(1, Math.ceil((durationMs / 1_000) * fps));

export const totalFrames = (props: ShortsRenderProps, fps: number): number =>
  Math.max(1, props.segments.reduce((total, segment) => total + framesForDuration(segment.durationMs, fps), 0));
