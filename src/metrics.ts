import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { get_encoding, type Tiktoken } from "tiktoken";

const HEADER =
  "timestamp,tool,cache_id,raw_bytes,sketched_bytes,bytes_saved_pct,raw_tokens,sketched_tokens,tokens_saved_pct\n";

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) encoder = get_encoding("cl100k_base");
  return encoder;
}

export function freeEncoder(): void {
  encoder?.free();
  encoder = null;
}

function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

function byteLen(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function pct(saved: number, raw: number): number {
  if (raw <= 0) return 0;
  return Math.round((saved / raw) * 1000) / 10;
}

export interface MetricRow {
  tool: string;
  cacheId: string;
  rawText: string;
  sketchedText: string;
}

export function recordMetric(csvPath: string, row: MetricRow): void {
  if (!existsSync(csvPath)) writeFileSync(csvPath, HEADER);

  const rawBytes = byteLen(row.rawText);
  const sketchedBytes = byteLen(row.sketchedText);
  const rawTokens = countTokens(row.rawText);
  const sketchedTokens = countTokens(row.sketchedText);

  const line = [
    new Date().toISOString(),
    row.tool,
    row.cacheId,
    rawBytes,
    sketchedBytes,
    pct(rawBytes - sketchedBytes, rawBytes),
    rawTokens,
    sketchedTokens,
    pct(rawTokens - sketchedTokens, rawTokens),
  ].join(",");

  appendFileSync(csvPath, line + "\n");
}
