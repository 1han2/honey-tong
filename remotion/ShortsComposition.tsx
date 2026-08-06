import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import type { ShortsRenderProps } from "./types";
import { framesForDuration } from "./types";

const WIDTH = 1_080;
const HEIGHT = 1_920;
const HEADER_HEIGHT = 440;
const VIDEO_HEIGHT = 1_160;

const titleFont = "'Black Han Sans', sans-serif";
const captionFont = "'Noto Sans KR', sans-serif";

const FontStyles = () => (
  <style>
    {`
      @import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@700;800&display=swap');
    `}
  </style>
);

/**
 * Top Hook Title: Max 140px Headline with dynamic character-length scaling.
 * Fits within 1050px bounds seamlessly.
 */
const HookTitle = ({ value }: { value: string }) => {
  const rawLines = value.split(/\r?\n/).filter(Boolean);
  let line1 = rawLines[0] || value;
  let line2 = rawLines[1] || "";

  // Split long lines if no explicit newline is given
  if (!line2 && line1.length > 14) {
    const spaceIdx = line1.lastIndexOf(" ", Math.ceil(line1.length / 2));
    if (spaceIdx > 0) {
      line2 = line1.slice(spaceIdx + 1);
      line1 = line1.slice(0, spaceIdx);
    }
  }

  const lines = [line1, line2].filter(Boolean);

  return (
    <div
      style={{
        alignItems: "center",
        backgroundColor: "#000000",
        display: "flex",
        flexDirection: "column",
        height: HEADER_HEIGHT,
        justifyContent: "center",
        padding: "6px 16px",
        textAlign: "center",
        width: WIDTH,
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 20,
      }}
    >
      {lines.map((line, index) => {
        // Dynamic font size: Max 140px, scaled down gracefully for longer lines
        const charCount = Math.max(line.length, 1);
        const autoFitSize = Math.floor(1050 / (charCount * 0.78));
        const finalSize = Math.max(68, Math.min(140, autoFitSize));

        return (
          <div
            key={`${index}-${line}`}
            style={{
              color: index === 0 ? "#FFE500" : "#FFFFFF",
              fontFamily: titleFont,
              fontSize: finalSize,
              fontWeight: 900,
              letterSpacing: -4,
              lineHeight: 1.06,
              textShadow: "0px 4px 18px rgba(0, 0, 0, 0.98), 0px 2px 5px rgba(0, 0, 0, 0.9)",
              filter: "drop-shadow(0px 4px 12px rgba(0, 0, 0, 0.95))",
              maxWidth: 1050,
              wordBreak: "keep-all",
              whiteSpace: "nowrap",
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Overlay Subtitle: Compact clean White Noto Sans KR (48px) overlayed on video
 */
const VideoOverlayCaption = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      position: "absolute",
      top: 1260,
      left: 40,
      right: 40,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 30,
      textAlign: "center",
      ...style,
    }}
  >
    <div
      style={{
        color: "#FFFFFF",
        fontFamily: captionFont,
        fontSize: 48,
        fontWeight: 800,
        lineHeight: 1.3,
        letterSpacing: -0.5,
        textAlign: "center",
        textShadow: "0px 4px 12px rgba(0, 0, 0, 0.98), 0px 2px 5px rgba(0, 0, 0, 0.9)",
        filter: "drop-shadow(0px 4px 10px rgba(0, 0, 0, 0.95))",
        wordBreak: "keep-all",
        maxWidth: 1000,
      }}
    >
      {children}
    </div>
  </div>
);

export const ShortsComposition = (props: ShortsRenderProps) => {
  const { fps } = useVideoConfig();
  let from = 0;
  const hookTitle = props.hookTitle?.trim() || props.title;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <FontStyles />
      {props.segments.map((segment, index) => {
        const durationInFrames = framesForDuration(segment.durationMs, fps);
        const sequenceFrom = from;
        from += durationInFrames;

        if (segment.type === "source_clip") {
          return (
            <Sequence key={`${index}-${segment.fileName}`} from={sequenceFrom} durationInFrames={durationInFrames}>
              <AbsoluteFill style={{ backgroundColor: "#000000" }}>
                <HookTitle value={hookTitle} />
                <OffthreadVideo
                  src={staticFile(segment.fileName)}
                  style={{
                    height: VIDEO_HEIGHT,
                    left: 0,
                    objectFit: "cover",
                    objectPosition: "center",
                    position: "absolute",
                    top: HEADER_HEIGHT,
                    width: WIDTH,
                  }}
                />
                <VideoOverlayCaption>{segment.subtitle}</VideoOverlayCaption>
              </AbsoluteFill>
            </Sequence>
          );
        }

        // Narration segment: Continuous background video with muted audio + Supertone TTS voice + Overlay Subtitle
        return (
          <Sequence key={`${index}-${segment.fileName}`} from={sequenceFrom} durationInFrames={durationInFrames}>
            <AbsoluteFill style={{ backgroundColor: "#000000" }}>
              <HookTitle value={hookTitle} />
              {segment.videoFileName ? (
                <OffthreadVideo
                  src={staticFile(segment.videoFileName)}
                  muted={true}
                  style={{
                    height: VIDEO_HEIGHT,
                    left: 0,
                    objectFit: "cover",
                    objectPosition: "center",
                    position: "absolute",
                    top: HEADER_HEIGHT,
                    width: WIDTH,
                  }}
                />
              ) : null}
              <Audio src={staticFile(segment.fileName)} />
              <VideoOverlayCaption>{segment.text}</VideoOverlayCaption>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
