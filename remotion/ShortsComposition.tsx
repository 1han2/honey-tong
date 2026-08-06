import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import type { ShortsRenderProps } from "./types.js";
import { framesForDuration } from "./types.js";

const WIDTH = 1_080;
const HEADER_HEIGHT = 360;
const SOURCE_SIZE = 1_080;
const FOOTER_HEIGHT = 1_920 - HEADER_HEIGHT - SOURCE_SIZE; // 480px

const titleFont = "'Black Han Sans', 'Noto Sans KR', sans-serif";
const captionFont = "'Black Han Sans', 'Noto Sans KR', sans-serif";

const FontStyles = () => (
  <style>
    {`
      @import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@800;900&display=swap');
    `}
  </style>
);

const HookTitle = ({ value }: { value: string }) => {
  const lines = value.split(/\r?\n/).filter(Boolean).slice(0, 2);
  return (
    <div
      style={{
        alignItems: "center",
        backgroundColor: "#000000",
        display: "flex",
        flexDirection: "column",
        height: HEADER_HEIGHT,
        justifyContent: "center",
        padding: "30px 48px 20px",
        textAlign: "center",
        width: WIDTH,
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 20,
      }}
    >
      {lines.map((line, index) => (
        <div
          key={`${index}-${line}`}
          style={{
            color: index === 0 ? "#F20D18" : "#FFFFFF",
            fontFamily: titleFont,
            fontSize: lines.length > 1 ? 76 : 84,
            fontWeight: 900,
            letterSpacing: -1.5,
            lineHeight: 1.15,
            textShadow: "0 4px 10px rgba(0, 0, 0, 0.95)",
            WebkitTextStroke: "2.5px #000000",
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};

const Caption = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      alignItems: "center",
      backgroundColor: "#000000",
      display: "flex",
      height: FOOTER_HEIGHT,
      justifyContent: "center",
      padding: "20px 60px 40px",
      position: "absolute",
      top: HEADER_HEIGHT + SOURCE_SIZE,
      left: 0,
      width: WIDTH,
      zIndex: 20,
      ...style,
    }}
  >
    <div
      style={{
        color: "#FFFFFF",
        fontFamily: captionFont,
        fontSize: 68,
        fontWeight: 900,
        lineHeight: 1.25,
        letterSpacing: -0.5,
        textAlign: "center",
        textShadow: "0 4px 12px rgba(0, 0, 0, 0.95)",
        WebkitTextStroke: "3px #000000",
        wordBreak: "keep-all",
        maxWidth: 960,
      }}
    >
      {children}
    </div>
  </div>
);

const SceneFrame = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ backgroundColor: "#000000" }}>{children}</AbsoluteFill>
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
              <SceneFrame>
                <HookTitle value={hookTitle} />
                <OffthreadVideo
                  src={staticFile(segment.fileName)}
                  style={{
                    height: SOURCE_SIZE,
                    left: 0,
                    objectFit: "cover",
                    objectPosition: "center",
                    position: "absolute",
                    top: HEADER_HEIGHT,
                    width: WIDTH,
                  }}
                />
                <Caption>{segment.subtitle}</Caption>
              </SceneFrame>
            </Sequence>
          );
        }

        // Narration segment: Continuous background video with muted audio + Supertone TTS voice
        return (
          <Sequence key={`${index}-${segment.fileName}`} from={sequenceFrom} durationInFrames={durationInFrames}>
            <SceneFrame>
              <HookTitle value={hookTitle} />
              {segment.videoFileName ? (
                <OffthreadVideo
                  src={staticFile(segment.videoFileName)}
                  muted={true}
                  style={{
                    height: SOURCE_SIZE,
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
              <Caption>{segment.text}</Caption>
            </SceneFrame>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
