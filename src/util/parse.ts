import type { UpstreamCallResult } from "../upstream.js";

export function extractTextFromUpstream(result: UpstreamCallResult): string | null {
  if (!result.content || !Array.isArray(result.content)) return null;
  const texts = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  if (texts.length === 0) return null;
  return texts.join("\n");
}

export function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
