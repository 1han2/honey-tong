import fs from "node:fs/promises";
import path from "node:path";

const distPath = path.resolve("dist");
if (path.basename(distPath) !== "dist") {
  throw new Error(`Refusing to clean unexpected path: ${distPath}`);
}
await fs.rm(distPath, { recursive: true, force: true });
