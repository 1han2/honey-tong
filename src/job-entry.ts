import { logger } from "./lib/logger.js";

const [command] = process.argv.slice(2);

switch (command) {
  case "scan":
    await import("./jobs/scan.js");
    break;
  case "produce":
    await import("./jobs/produce.js");
    break;
  case "import-channels":
    await import("../scripts/import-channels.js");
    break;
  case "gemini-live":
    await import("./jobs/gemini-live.js");
    break;
  default:
    logger.error({ command }, "unknown job command; expected scan, produce, import-channels, or gemini-live");
    process.exitCode = 2;
}
