#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { ResponseCache } from "./cache.js";
import { sketchValue, queryValue } from "./sketch.js";
import { recordMetric, freeEncoder } from "./metrics.js";
import { UpstreamMcp } from "./upstream.js";

import { QUERY_RESPONSE_TOOL } from "./const/tools.js";
import {
  MSG_MISSING_PAT,
  MSG_READY,
  msgUpstreamConnected,
  msgUnknownCacheId,
  msgPathCommaHint,
  wrapSketchResponse,
} from "./const/messages.js";

import { extractTextFromUpstream, tryParseJson } from "./util/parse.js";
import { buildToolError } from "./util/errors.js";
import { registerShutdown } from "./util/shutdown.js";

loadEnv();

const PAT = process.env.GITHUB_PAT;
const UPSTREAM_URL =
  process.env.UPSTREAM_MCP_URL ?? "https://api.githubcopilot.com/mcp";
const CACHE_SIZE = Number(process.env.CACHE_SIZE ?? 50);
const METRICS_CSV = process.env.METRICS_CSV ?? null;

if (!PAT) {
  console.error(MSG_MISSING_PAT);
  process.exit(1);
}

async function main(): Promise<void> {
  const upstream = new UpstreamMcp(UPSTREAM_URL, PAT!);
  await upstream.connect();
  const upstreamTools = await upstream.listTools();
  console.error(msgUpstreamConnected(upstreamTools.length));

  const cache = new ResponseCache(CACHE_SIZE);

  const server = new Server(
    { name: "github-mcp-sketch", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Pass upstream tool descriptions through unchanged. The schema-sketch
    // behavior teaches itself on the first call: every response wraps with
    // `cache_id: gh-N-xxx (pass to query_response)\n\n<schema>`, and the
    // `query_response` tool's own description explains how to use it.
    // Appending a per-tool NOTE here would cost ~60 tokens × every upstream
    // tool, which on heavy tool sets is several thousand wasted input tokens
    // per request — the very thing the proxy is supposed to save.
    const tools: Tool[] = upstreamTools.map((t) => ({ ...t }));
    tools.push(QUERY_RESPONSE_TOOL);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const args = req.params.arguments;

    if (toolName === "query_response") {
      const argsObj = (args ?? {}) as Record<string, unknown>;
      const cacheId = String(argsObj.cache_id ?? "");
      const maxItems =
        typeof argsObj.max_items === "number" ? argsObj.max_items : Infinity;

      const entry = cache.get(cacheId);
      if (!entry) {
        return buildToolError(
          msgUnknownCacheId(
            cacheId,
            cache.list().map((e) => e.id),
          ),
        );
      }

      const pathInput = argsObj.path;
      const isBatch = Array.isArray(pathInput);
      const paths: string[] = isBatch
        ? (pathInput as unknown[]).map((p) => String(p))
        : [String(pathInput ?? "")];

      const resolveOne = (p: string): Record<string, unknown> => {
        const r = queryValue(entry.response, p, maxItems);
        if (!r.ok) {
          const msg = p.includes(",")
            ? `${msgPathCommaHint(p)}\n\nOriginal parser error: ${r.error}`
            : r.error;
          return { error: msg };
        }
        const out: Record<string, unknown> = { value: r.value };
        const returned = Array.isArray(r.value) ? r.value.length : 0;
        if (r.totalItems !== undefined && r.totalItems > returned) {
          out.totalItems = r.totalItems;
        }
        return out;
      };

      if (!isBatch) {
        const single = resolveOne(paths[0]);
        if ("error" in single) return buildToolError(single.error as string);
        return {
          content: [{ type: "text", text: JSON.stringify(single, null, 2) }],
        };
      }

      const results: Record<string, Record<string, unknown>> = {};
      for (const p of paths) results[p] = resolveOne(p);
      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    }

    const upstreamResult = await upstream.callTool(toolName, args);
    if (upstreamResult.isError) return upstreamResult;

    const rawText = extractTextFromUpstream(upstreamResult);
    if (rawText === null) return upstreamResult;

    const parsed = tryParseJson(rawText);
    if (parsed === undefined) return upstreamResult;

    const schema = sketchValue(parsed);
    const cacheId = cache.put(toolName, args, parsed);
    const wrapped = wrapSketchResponse(cacheId, schema);

    if (METRICS_CSV) {
      try {
        recordMetric(METRICS_CSV, {
          tool: toolName,
          cacheId,
          rawText,
          sketchedText: wrapped,
        });
      } catch (err) {
        console.error("[github-mcp-sketch] metrics write failed:", err);
      }
    }

    return { content: [{ type: "text", text: wrapped }] };
  });

  registerShutdown([
    async () => {
      try {
        await upstream.close();
      } catch {}
    },
    () => freeEncoder(),
  ]);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(MSG_READY);
}

main().catch((err) => {
  console.error("[github-mcp-sketch] fatal:", err);
  process.exit(1);
});
