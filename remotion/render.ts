import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { ShortsRenderProps } from "./types.js";

export const renderShorts = async (input: {
  publicDir: string;
  outputPath: string;
  props: ShortsRenderProps;
  concurrency?: number;
}): Promise<void> => {
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
  const serveUrl = await bundle({
    entryPoint: path.resolve("remotion/index.ts"),
    publicDir: input.publicDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: {
          ...config.resolve?.extensionAlias,
          ".js": [".ts", ".tsx", ".js"],
        },
      },
    }),
  });
  const composition = await selectComposition({
    serveUrl,
    id: "AffiliateShorts",
    inputProps: input.props,
    ...(browserExecutable ? { browserExecutable } : {}),
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: input.outputPath,
    inputProps: input.props,
    concurrency: input.concurrency ?? 2,
    ...(browserExecutable ? { browserExecutable } : {}),
    chromiumOptions: {
      disableWebSecurity: true,
    },
  });
};
