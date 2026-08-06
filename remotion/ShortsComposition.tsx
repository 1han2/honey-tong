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
const HEIGHT = 1_920;

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
        position: "absolute",
        top: 130,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 20,
        padding: "0 40px",
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255, 0, 85, 0.95) 0%, rgba(255, 80, 0, 0.95) 100%)",
          padding: "18px 40px",
          borderRadius: 36,
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.7), 0 0 24px rgba(255, 0, 85, 0.5)",
          border: "2.5px solid rgba(255, 255, 255, 0.4)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          textAlign: "center",
          maxWidth: 960,
        }}
      >
        {lines.map((line, index) => (
          <div
            key={`${index}-${line}`}
            style={{
              color: index === 0 ? "#FFFFFF" : "#FFE500",
              fontFamily: titleFont,
              fontSize: lines.length > 1 ? 52 : 58,
              fontWeight: 900,
              letterSpacing: -1,
              lineHeight: 1.15,
              WebkitTextStroke: "2.5px #000",
              textShadow: "0 4px 12px rgba(0, 0, 0, 0.9)",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

const Caption = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      position: "absolute",
      top: 1320,
      left: 60,
      right: 60,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 20,
      ...style,
    }}
  >
    <div
      style={{
        background: "rgba(0, 0, 0, 0.82)",
        padding: "20px 42px",
        borderRadius: 28,
        border: "2px solid rgba(255, 255, 255, 0.2)",
        boxShadow: "0 14px 36px rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(12px)",
        textAlign: "center",
        maxWidth: 960,
      }}
    >
      <span
        style={{
          color: "#FFE500",
          fontFamily: captionFont,
          fontSize: 62,
          fontWeight: 900,
          lineHeight: 1.25,
          letterSpacing: -0.5,
          WebkitTextStroke: "3px #000000",
          textShadow: "0 4px 14px rgba(0,0,0,0.95)",
          display: "inline-block",
        }}
      >
        {children}
      </span>
    </div>
  </div>
);

const VideoBackgroundOverlay = () => (
  <>
    {/* Top subtle vignette for title contrast */}
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 380,
        background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
        zIndex: 5,
        pointerEvents: "none",
      }}
    />
    {/* Bottom subtle vignette for caption contrast */}
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 500,
        background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
        zIndex: 5,
        pointerEvents: "none",
      }}
    />
  </>
);

export const ShortsComposition = (props: ShortsRenderProps) => {
  const { fps } = useVideoConfig();
  let from = 0;
  const hookTitle = props.hookTitle?.trim() || props.title;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <FontStyles />
      {props.segments.map((segment, index) => {
        const durationInFrames = framesForDuration(segment.durationMs, fps);
        const sequenceFrom = from;
        from += durationInFrames;

        if (segment.type === "source_clip") {
          return (
            <Sequence key={`${index}-${segment.fileName}`} from={sequenceFrom} durationInFrames={durationInFrames}>
              <AbsoluteFill style={{ backgroundColor: "#000" }}>
                <OffthreadVideo
                  src={staticFile(segment.fileName)}
                  style={{
                    height: HEIGHT,
                    width: WIDTH,
                    objectFit: "cover",
                    objectPosition: "center",
                    position: "absolute",
                    top: 0,
                    left: 0,
                  }}
                />
                <VideoBackgroundOverlay />
                <HookTitle value={hookTitle} />
                <Caption>{segment.subtitle}</Caption>
              </AbsoluteFill>
            </Sequence>
          );
        }

        // Narration segment: Continuous background video with muted audio + Supertone TTS voice
        return (
          <Sequence key={`${index}-${segment.fileName}`} from={sequenceFrom} durationInFrames={durationInFrames}>
            <AbsoluteFill style={{ backgroundColor: "#000" }}>
              {segment.videoFileName ? (
                <OffthreadVideo
                  src={staticFile(segment.videoFileName)}
                  muted={true}
                  style={{
                    height: HEIGHT,
                    width: WIDTH,
                    objectFit: "cover",
                    objectPosition: "center",
                    position: "absolute",
                    top: 0,
                    left: 0,
                  }}
                />
              ) : null}
              <VideoBackgroundOverlay />
              <HookTitle value={hookTitle} />
              <Audio src={staticFile(segment.fileName)} />
              <Caption>{segment.text}</Caption>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
