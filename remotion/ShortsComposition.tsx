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
const FOOTER_HEIGHT = 1_920 - HEADER_HEIGHT - SOURCE_SIZE;
const titleFont = "'Noto Sans CJK KR', 'Noto Sans KR', sans-serif";
const captionFont = "'Noto Sans CJK KR', 'Noto Sans KR', sans-serif";
const textShadow = "0 4px 0 #000, 0 5px 14px rgba(0,0,0,0.95)";

const HookTitle = ({ value }: { value: string }) => {
  const lines = value.split(/\r?\n/).filter(Boolean).slice(0, 2);
  return (
    <div
      style={{
        alignItems: "center",
        backgroundColor: "#050505",
        display: "flex",
        flexDirection: "column",
        height: HEADER_HEIGHT,
        justifyContent: "center",
        padding: "34px 56px 26px",
        textAlign: "center",
        width: WIDTH,
      }}
    >
      {lines.map((line, index) => (
        <div
          key={`${index}-${line}`}
          style={{
            color: index === 0 ? "#f20d18" : "#fff",
            fontFamily: titleFont,
            fontSize: 84,
            fontWeight: 900,
            letterSpacing: -3,
            lineHeight: 1.12,
            textShadow,
            WebkitTextStroke: "2px #000",
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
      color: "#f4f4f4",
      fontFamily: captionFont,
      fontSize: 58,
      fontWeight: 800,
      lineHeight: 1.25,
      padding: "0 72px",
      textAlign: "center",
      textShadow,
      WebkitTextStroke: "2px #111",
      ...style,
    }}
  >
    {children}
  </div>
);

const SceneFrame = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>{children}</AbsoluteFill>
);

export const ShortsComposition = (props: ShortsRenderProps) => {
  const { fps } = useVideoConfig();
  let from = 0;
  const hookTitle = props.hookTitle?.trim() || props.title;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
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
                <Caption
                  style={{
                    bottom: FOOTER_HEIGHT + 42,
                    left: 0,
                    position: "absolute",
                    right: 0,
                  }}
                >
                  {segment.subtitle}
                </Caption>
              </SceneFrame>
            </Sequence>
          );
        }

        return (
          <Sequence key={`${index}-${segment.fileName}`} from={sequenceFrom} durationInFrames={durationInFrames}>
            <AbsoluteFill style={{ backgroundColor: "#000" }}>
              <HookTitle value={hookTitle} />
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  height: FOOTER_HEIGHT + SOURCE_SIZE,
                  justifyContent: "flex-end",
                  paddingBottom: 120,
                  position: "absolute",
                  top: HEADER_HEIGHT,
                  width: WIDTH,
                }}
              >
                <Audio src={staticFile(segment.fileName)} />
                <Caption style={{ fontSize: 64 }}>{segment.text}</Caption>
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
