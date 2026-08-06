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
const HEADER_HEIGHT = 320;
const VIDEO_HEIGHT = 1_280;

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
        padding: "24px 40px 16px",
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
            fontSize: lines.length > 1 ? 72 : 80,
            fontWeight: 900,
            letterSpacing: -1.5,
            lineHeight: 1.15,
            paintOrder: "stroke fill",
            WebkitTextStroke: "4px #000000",
            textShadow: "0 6px 14px rgba(0, 0, 0, 0.95), 0 2px 4px rgba(0, 0, 0, 0.8)",
            filter: "drop-shadow(0px 6px 12px rgba(0, 0, 0, 0.95))",
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};

/**
 * Overlay Subtitle: Rendered DIRECTLY ON TOP OF THE VIDEO FRAME (no black box underneath)
 * Matches reference Shorts Pe5mnWKTCfg & d21zthnRKiQ.
 */
const VideoOverlayCaption = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      position: "absolute",
      top: 1240,
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
        fontSize: 66,
        fontWeight: 900,
        lineHeight: 1.25,
        letterSpacing: -0.5,
        textAlign: "center",
        paintOrder: "stroke fill",
        WebkitTextStroke: "4.5px #000000",
        textShadow: "0 6px 18px rgba(0, 0, 0, 0.95), 0 2px 6px rgba(0, 0, 0, 0.9)",
        filter: "drop-shadow(0px 6px 14px rgba(0, 0, 0, 0.95))",
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
