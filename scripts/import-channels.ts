import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { loadConfig } from "../src/config.js";
import { ShortsRepository } from "../src/lib/firestore.js";
import { logger } from "../src/lib/logger.js";
import { channelSchema, type Channel } from "../src/lib/schemas.js";

type Cell = string | number | boolean | null;

type XlsxCell = {
  "@_r"?: string;
  "@_t"?: string;
  v?: string;
  is?: { t?: string };
};

type XlsxRow = { "@_r"?: string; c?: XlsxCell | XlsxCell[] };

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const columnIndex = (reference: string): number => {
  const letters = /^[A-Z]+/.exec(reference)?.[0];
  if (!letters) throw new Error(`Invalid XLSX cell reference: ${reference}`);
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const defaultInput = path.resolve("db/연예인_채널_DB_20260727_channel_id.xlsx");
const inputArg = process.argv.find((arg) => arg.startsWith("--input="));
const inputPath = path.resolve(inputArg?.slice("--input=".length) ?? defaultInput);
const apply = process.argv.includes("--apply");

if (!fs.existsSync(inputPath)) {
  throw new Error(`Channel workbook not found: ${inputPath}`);
}

const fileSize = fs.statSync(inputPath).size;
if (fileSize > 10 * 1024 * 1024) throw new Error(`Channel workbook is unexpectedly large: ${fileSize}`);
const archive = unzipSync(new Uint8Array(fs.readFileSync(inputPath)));
const workbookXml = archive["xl/workbook.xml"];
const sheetXml = archive["xl/worksheets/sheet1.xml"];
if (!workbookXml || !sheetXml) throw new Error("Channel workbook is missing required XLSX parts");

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});
const workbookData = xmlParser.parse(strFromU8(workbookXml)) as {
  workbook?: { sheets?: { sheet?: { "@_name"?: string } | Array<{ "@_name"?: string }> } };
};
const sheetName = asArray(workbookData.workbook?.sheets?.sheet)[0]?.["@_name"] ?? "Sheet1";
const sheetData = xmlParser.parse(strFromU8(sheetXml)) as {
  worksheet?: { sheetData?: { row?: XlsxRow | XlsxRow[] } };
};
const rows: Cell[][] = [];
for (const xlsxRow of asArray(sheetData.worksheet?.sheetData?.row)) {
  const rowIndex = Number.parseInt(xlsxRow["@_r"] ?? "0", 10) - 1;
  if (rowIndex < 0) continue;
  const row: Cell[] = [];
  for (const cell of asArray(xlsxRow.c)) {
    const reference = cell["@_r"];
    if (!reference) continue;
    const raw = cell.v ?? cell.is?.t ?? "";
    const type = cell["@_t"];
    const value: Cell = type === "n" ? Number(raw) : type === "b" ? raw === "1" : raw;
    row[columnIndex(reference)] = value;
  }
  rows[rowIndex] = row;
}
const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? "").trim() === "YouTube Channel ID"));
if (headerIndex < 0) throw new Error("Could not find 'YouTube Channel ID' header");

const header = rows[headerIndex]?.map((cell) => String(cell ?? "").trim()) ?? [];
const column = (name: string): number => {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`Missing required column: ${name}`);
  return index;
};

const celebrityIndex = column("연예인 이름");
const channelNameIndex = column("유튜브 채널명");
const channelUrlIndex = column("채널 주소");
const channelIdIndex = column("YouTube Channel ID");

const channels: Channel[] = [];
const invalidRows: Array<{ row: number; errors: string[] }> = [];

export const cleanCelebrityName = (name: string): string =>
  name
    .replace(/\s*[\(\（\[].*?[\)\）\]]\s*/g, "")
    .replace(/\s*[\(\（\[].*$/g, "")
    .trim();

for (let index = headerIndex + 1; index < rows.length; index += 1) {
  const row = rows[index];
  if (!row || row.every((cell) => cell === null || String(cell).trim() === "")) continue;
  const parsed = channelSchema.safeParse({
    celebrityName: cleanCelebrityName(String(row[celebrityIndex] ?? "").trim()),
    channelName: String(row[channelNameIndex] ?? "").trim(),
    channelUrl: String(row[channelUrlIndex] ?? "").trim(),
    youtubeChannelId: String(row[channelIdIndex] ?? "").trim(),
    enabled: true,
    sourceRow: index + 1,
  });
  if (!parsed.success) {
    invalidRows.push({
      row: index + 1,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    continue;
  }
  channels.push(parsed.data);
}

const uniqueChannels = [...new Map(channels.map((channel) => [channel.youtubeChannelId, channel])).values()];
logger.info(
  {
    inputPath,
    sheetName,
    validRows: channels.length,
    uniqueChannels: uniqueChannels.length,
    invalidRows,
    mode: apply ? "apply" : "dry-run",
  },
  "channel workbook parsed",
);

if (!apply) {
  logger.info("dry-run complete; pass --apply to write channels to Firestore");
  process.exit(0);
}

const repository = new ShortsRepository(loadConfig());
await repository.upsertChannels(uniqueChannels);
logger.info({ count: uniqueChannels.length }, "channels imported to Firestore");
