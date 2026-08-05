import { describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeGeminiJsonSchema } from "../src/lib/json-schema.js";
import { productAnalysisSchema, scriptPlanSchema } from "../src/lib/schemas.js";

describe("Gemini JSON schema", () => {
  it("converts Zod keywords that Gemini does not support", () => {
    const normalized = normalizeGeminiJsonSchema(
      z.toJSONSchema(scriptPlanSchema) as Record<string, unknown>,
    );
    const json = JSON.stringify(normalized);

    expect(json).not.toContain('"$schema"');
    expect(json).not.toContain('"const"');
    expect(json).not.toContain('"default"');
    expect(json).not.toContain('"exclusiveMinimum"');
    expect(json).not.toContain('"minLength"');
    expect(json).not.toContain('"maxLength"');
    expect(json).toContain('"enum":["source_clip"]');
    expect(json).toContain('"sourceEndMs":{"type":"integer","maximum":9007199254740991,"minimum":1}');

    const productJson = JSON.stringify(
      normalizeGeminiJsonSchema(z.toJSONSchema(productAnalysisSchema) as Record<string, unknown>),
    );
    expect(productJson).toContain('"brand":{"type":["string","null"]}');
  });
});
