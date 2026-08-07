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
        const autoFitSize = Math.floor(1050 / (charCount * 0.72));
        const finalSize = Math.max(90, Math.min(160, autoFitSize));

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

export const splitIntoMicroChunks = (text: string, maxWords = 3): string[] => {
  const clean = text.replace(/\.+$|\.\s*$/g, "").replace(/\r?\n+/g, " ").replaceAll(/\s+/g, " ").trim();
  if (!clean) return [];

  const words = clean.split(" ");
  if (words.length <= maxWords) return [clean];

  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= maxWords) {
      chunks.push(current.join(" "));
      current = [];
    }
  }

  if (current.length > 0) {
    if (current.length === 1 && chunks.length > 0) {
      chunks[chunks.length - 1] += ` ${current[0]}`;
    } else {
      chunks.push(current.join(" "));
    }
  }

  return chunks;
};

const formatSubtitleText = (text: ReactNode): ReactNode => {
  if (typeof text !== "string") return text;
  const str = text.replace(/\.+$|\.\s*$/g, "").trim();

  if (str.includes("*")) {
    const parts = str.split(/(\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <span key={i} style={{ color: "#E53935" }}>
            {part.slice(1, -1)}
          </span>
        );
      }
      return part;
    });
  }

  return str;
};

/**
 * Overlay Subtitle: Lower-positioned Subtitle with White Background Box and Black Border
 */
const VideoOverlayCaption = ({
  children,
  isNarration = false,
  style,
}: {
  children: ReactNode;
  isNarration?: boolean;
  style?: CSSProperties;
}) => (
  <div
    style={{
      position: "absolute",
      top: HEADER_HEIGHT,
      height: VIDEO_HEIGHT,
      left: 40,
      right: 40,
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-end",
      paddingBottom: 220,
      zIndex: 30,
      textAlign: "center",
      pointerEvents: "none",
      ...style,
    }}
  >
    <div
      style={{
        backgroundColor: isNarration ? "#FFF59D" : "#FFFFFF",
        border: "6px solid #000000",
        borderRadius: 0,
        padding: "16px 36px",
        boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.15)",
        display: "inline-block",
        maxWidth: 960,
      }}
    >
      <div
        style={{
          color: "#000000",
          fontFamily: captionFont,
          fontSize: 70,
          fontWeight: 800,
          lineHeight: 1.3,
          letterSpacing: -0.5,
          textAlign: "center",
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {formatSubtitleText(children)}
      </div>
    </div>
  </div>
);

const MicroChunkSubtitles = ({
  text,
  durationInFrames,
  isNarration,
}: {
  text: string;
  durationInFrames: number;
  isNarration: boolean;
}) => {
  const chunks = splitIntoMicroChunks(text, 3);
  if (chunks.length <= 1) {
    return <VideoOverlayCaption isNarration={isNarration}>{text}</VideoOverlayCaption>;
  }

  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
  let currentFrom = 0;

  return (
    <>
      {chunks.map((chunk, index) => {
        const isLast = index === chunks.length - 1;
        const chunkRatio = chunk.length / Math.max(1, totalChars);
        const chunkFrames = isLast
          ? Math.max(1, durationInFrames - currentFrom)
          : Math.max(1, Math.round(durationInFrames * chunkRatio));

        const fromFrame = currentFrom;
        currentFrom += chunkFrames;

        return (
          <Sequence key={`${index}-${chunk}`} from={fromFrame} durationInFrames={chunkFrames}>
            <VideoOverlayCaption isNarration={isNarration}>{chunk}</VideoOverlayCaption>
          </Sequence>
        );
      })}
    </>
  );
};

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
                <MicroChunkSubtitles text={segment.subtitle} durationInFrames={durationInFrames} isNarration={false} />
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
              <MicroChunkSubtitles text={segment.text} durationInFrames={durationInFrames} isNarration={true} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
