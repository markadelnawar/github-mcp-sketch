export const MSG_MISSING_PAT =
  "[github-mcp-sketch] GITHUB_PAT is not set. Refusing to start.";

export const MSG_READY = "[github-mcp-sketch] ready on stdio.";

export function msgUpstreamConnected(toolCount: number): string {
  return `[github-mcp-sketch] Connected upstream. ${toolCount} tools available.`;
}

export function msgUnknownCacheId(cacheId: string, available: string[]): string {
  const list = available.length === 0 ? "(none)" : available.join(", ");
  return (
    `Unknown cache_id "${cacheId}". Available: ${list}. ` +
    `Call an upstream tool first to populate the cache.`
  );
}

export function wrapSketchResponse(cacheId: string, schema: string): string {
  return `cache_id: ${cacheId} (pass to query_response)\n\n${schema}`;
}

export function msgPathCommaHint(path: string): string {
  return (
    `Path "${path}" contains a comma. Path strings do NOT support comma-separated field selection. ` +
    `To get multiple fields in one call, pass an array of paths instead: ` +
    `path=["[*].title","[*].state","[*].user.login"]. Each path is run against the same cached response ` +
    `and the results are returned together in one tool call.`
  );
}
