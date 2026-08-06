import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  staticFile,
  useVideoConfig,
} from "remotion";
import type { ShortsRenderProps } from "./types.js";
import { framesForDuration } from "./types.js";

const WIDTH = 1_080;
const HEIGHT = 1_920;
const HEADER_HEIGHT = 440;
const VIDEO_HEIGHT = 1_160;

const titleFont = "'Jua', sans-serif";
const captionFont = "'Noto Sans KR', sans-serif";

const FontStyles = () => (
  <style>
    {`
      @font-face {
        font-family: 'Jua';
        src: local('Jua'), local('Jua-Regular'), url('${staticFile("fonts/Jua-Regular.ttf")}') format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: block;
      }
      @font-face {
        font-family: 'Noto Sans KR';
        src: local('Noto Sans KR'), local('NotoSansKR-Bold'), url('${staticFile("fonts/NotoSansKR-Bold.ttf")}') format('truetype');
        font-weight: 800;
        font-style: normal;
        font-display: block;
      }
    `}
  </style>
);

/**
 * Top Hook Title: ULTRA MASSIVE 140px Headline using Google 'Jua' Font
 * Fits within 1050px bounds seamlessly based on line character count.
 */
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
        const charCount = Math.max(line.length, 1);
        const autoFitSize = Math.floor(1050 / (charCount * 0.65));
        const finalSize = Math.max(96, Math.min(160, autoFitSize));

        return (
          <div
            key={`${index}-${line}`}
            style={{
              color: index === 0 ? "#FFE500" : "#FFFFFF",
              fontFamily: titleFont,
              fontSize: finalSize,
              fontWeight: 400,
              letterSpacing: -2,
              lineHeight: 1.08,
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

const formatSubtitleText = (text: ReactNode): ReactNode => {
  if (typeof text !== "string") return text;
  const str = text.replace(/\.+$|\.\s*$/g, "").trim();
  if (str.includes("\n")) return str;

  if (str.length > 14) {
    const words = str.split(" ");
    if (words.length > 1) {
      let currentLength = 0;
      let splitIndex = 1;
      const targetMid = str.length / 2;
      let minDiff = Number.POSITIVE_INFINITY;

      for (let i = 0; i < words.length - 1; i++) {
        currentLength += words[i]!.length + 1;
        const diff = Math.abs(currentLength - targetMid);
        if (diff < minDiff) {
          minDiff = diff;
          splitIndex = i + 1;
        }
      }
      return `${words.slice(0, splitIndex).join(" ")}\n${words.slice(splitIndex).join(" ")}`;
    }
  }
  return str;
};

/**
 * Overlay Subtitle: Vertically and Horizontally centered clean White Noto Sans KR (52px) overlay
 */
const VideoOverlayCaption = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      position: "absolute",
      top: HEADER_HEIGHT,
      height: VIDEO_HEIGHT,
      left: 60,
      right: 60,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 30,
      textAlign: "center",
      pointerEvents: "none",
      ...style,
    }}
  >
    <div
      style={{
        color: "#FFFFFF",
        fontFamily: captionFont,
        fontSize: 52,
        fontWeight: 800,
        lineHeight: 1.35,
        letterSpacing: -0.5,
        textAlign: "center",
        textShadow: "0px 4px 14px rgba(0, 0, 0, 0.98), 0px 2px 6px rgba(0, 0, 0, 0.95)",
        filter: "drop-shadow(0px 4px 12px rgba(0, 0, 0, 0.95))",
        wordBreak: "keep-all",
        whiteSpace: "pre-wrap",
        maxWidth: 820,
      }}
    >
      {formatSubtitleText(children)}
    </div>
  </div>
);

export const ShortsComposition = (props: ShortsRenderProps) => {
  const { fps } = useVideoConfig();
  let from = 0;
  const hookTitle = props.hookTitle?.trim() || props.title;

  const [handle] = useState(() => delayRender("Loading local TTF fonts"));
  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([
        document.fonts.load("400 100px 'Jua'"),
        document.fonts.load("800 48px 'Noto Sans KR'"),
        document.fonts.ready,
      ])
        .then(() => {
          continueRender(handle);
        })
        .catch(() => {
          continueRender(handle);
        });
    } else {
      continueRender(handle);
    }
  }, [handle]);

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
