const normalizeNode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeNode);
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (["$schema", "default", "exclusiveMinimum", "minLength", "maxLength"].includes(key)) continue;
    if (key === "const") {
      output.enum = [normalizeNode(child)];
      continue;
    }
    output[key] = normalizeNode(child);
  }

  const anyOf = output.anyOf;
  if (
    Array.isArray(anyOf) &&
    anyOf.length > 0 &&
    anyOf.every(
      (item) =>
        item &&
        typeof item === "object" &&
        Object.keys(item).every((key) => key === "type") &&
        (item as { type?: unknown }).type !== undefined,
    )
  ) {
    const types = anyOf.map((item) => (item as { type: unknown }).type);
    if (types.every((type) => typeof type === "string")) {
      output.type = types;
      delete output.anyOf;
    }
  }

  if (input.type === "integer" && typeof input.exclusiveMinimum === "number") {
    const inclusiveMinimum = Math.floor(input.exclusiveMinimum) + 1;
    output.minimum = Math.max(
      inclusiveMinimum,
      typeof input.minimum === "number" ? input.minimum : Number.NEGATIVE_INFINITY,
    );
  }
  return output;
};

/** Removes unsupported JSON Schema keywords before sending a schema to Gemini. */
export const normalizeGeminiJsonSchema = (schema: Record<string, unknown>): Record<string, unknown> =>
  normalizeNode(schema) as Record<string, unknown>;
