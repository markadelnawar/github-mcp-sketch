import { inferSchema, renderSchema, resolvePath } from "json-schema-sketch";
import type { ResolveResult, ResolveError } from "json-schema-sketch";

export function sketchValue(value: unknown): string {
  const node = inferSchema(value);
  return renderSchema(node);
}

export function queryValue(
  value: unknown,
  path: string,
  maxItems: number,
): ResolveResult | ResolveError {
  return resolvePath(value, path, maxItems);
}
