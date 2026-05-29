import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const QUERY_RESPONSE_TOOL: Tool = {
  name: "query_response",
  description:
    "Extract values from a response cached by a previous tool call.\n\n" +
    "PATH SYNTAX (per path):\n" +
    '  "user.login"             → nested key\n' +
    '  "[0].title"              → array index, then key\n' +
    '  "[*].title"              → wildcard: title from each array element\n' +
    '  "items[*].user.login"    → wildcard with nested key\n' +
    '  ""                       → return the whole cached value\n\n' +
    "BATCH MULTIPLE FIELDS IN ONE CALL — pass `path` as an array of strings:\n" +
    '  path: ["[*].title", "[*].state", "[*].user.login"]\n' +
    "  → returns { results: { \"<path>\": {value,...}, ... } }, one entry per path.\n" +
    "  Per-path errors are reported in that path's entry; other paths still succeed.\n\n" +
    "Notes:\n" +
    "  - Do NOT comma-separate fields inside a single path string. Use the array form.\n" +
    "  - max_items applies to every wildcard expansion in the batch.\n" +
    "  - Single string returns the value directly; array returns a results map.",
  inputSchema: {
    type: "object",
    properties: {
      cache_id: {
        type: "string",
        description: "cache_id returned by a previous proxy tool call.",
      },
      path: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" }, minItems: 1 },
        ],
        description:
          'Single path string OR array of path strings. Examples: "user.login" | "[*].title" | ["[*].title", "[*].state"]. Empty string returns the whole cached value. No commas inside a path.',
      },
      max_items: {
        type: "number",
        description:
          "OPTIONAL cap on items returned per wildcard expansion. Default unlimited — returns all items. Set this only when you specifically want a sample (e.g. \"give me the first 5 titles to scan\"). Applies to every path in a batch.",
      },
    },
    required: ["cache_id", "path"],
  },
};
