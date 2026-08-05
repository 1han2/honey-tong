import { createHash } from "node:crypto";

const normalize = (value: string): string =>
  value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");

export const candidateIdFor = (videoId: string, productName: string): string => {
  const digest = createHash("sha256")
    .update(`${videoId}\u0000${normalize(productName)}`)
    .digest("hex")
    .slice(0, 20);
  return `${videoId}_${digest}`;
};
