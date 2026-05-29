# github-mcp-sketch

A local MCP server that proxies the [GitHub MCP](https://github.com/github/github-mcp-server) and returns the JSON's inferred schema instead of the raw response. Adds a `query_response` tool the agent uses to pull specific fields it actually needs.

The point: most GitHub API responses are 80%+ metadata the agent doesn't read. `list_pull_requests` for 30 PRs is ~80KB; the agent usually needs 4–5 fields per PR. Returning a schema first lets the model see the shape and decide what to fetch back.

## What the numbers look like

Benchmarked across 13 agentic tasks on [`facebook/react`](https://github.com/facebook/react) and [`kubernetes/kubernetes`](https://github.com/kubernetes/kubernetes), Anthropic SDK with prompt caching enabled (matching how Claude Code uses the API). N=3 runs per case per side. Sum of medians across all 13 cases:

| Metric | Baseline (`github`) | Sketch (`github-sketch`) | Δ |
|---|---|---|---|
| Final context size (tokens) | 844,136 | 348,292 | **−58.7%** |
| API cost (Claude Opus 4.7) | $5.59 | $2.73 | **−51.2%** |
| Total tokens billed | 1.84M | 1.27M | −30.8% |

Where the win lives — the 13 cases grouped by the shape of response they exercise:

| Response shape | Cases | Baseline ctx | Δ context | Δ cost |
|---|---|---|---|---|
| Single-object fetches (one issue, one PR) | 2 | 34,740 | +3% | +52% |
| List endpoints with rich metadata (30+ items, lots of URL/reaction noise) | 3 | 222,827 | **−74%** | **−71%** |
| Comment-heavy threads (KEP review, long React discussion) | 3 | 387,913 | **−69%** | **−57%** |
| Multi-step agentic workflows (triage, investigation, drill-down) | 3 | 158,329 | **−40%** | **−27%** |
| File contents and commit history | 2 | 40,327 | −2% | 0% |

The first and last rows are where the proxy doesn't help — but notice they're also the rows where baseline context is already small (~35–40K tokens). A small percentage loss on a small payload barely moves anything in practice. The big absolute numbers are in tiers 2–4 (158K–388K baseline), which is exactly where the proxy's percentage savings translate into 100K+ tokens of headroom in real sessions. Both honest-loss rows were included intentionally so the data isn't cherry-picked.

Full report and reproducible bench: [`json-schema-sketch-bench`](https://github.com/markadelnawar/json-schema-sketch-bench).

## How it works

Every upstream tool call (`list_issues`, `pull_request_read`, etc.) goes through this pipeline:

1. The proxy forwards the call to `https://api.githubcopilot.com/mcp` with the agent-supplied PAT.
2. The raw JSON response is cached in memory under a generated `cache_id`.
3. The response shape is inferred via [`json-schema-sketch`](https://github.com/markadelnawar/json-schema-sketch) into a compact text-form schema.
4. The proxy returns `cache_id: gh-1-abc (pass to query_response)` followed by the schema. That's the entire tool result the agent sees.

When the agent wants actual values, it calls `query_response`:

```
query_response(cache_id="gh-1-abc", path="items[*].title")
```

Path syntax supports dot/bracket navigation and `[*]` wildcards. The agent can pass an array of paths to batch multiple field extractions into one tool call:

```
query_response(cache_id="gh-1-abc", path=["items[*].title", "items[*].state", "items[*].user.login"])
```

Cache entries live until the proxy process exits. There's no TTL; the design assumes one agent session per proxy process.

## Install

Requires Node 20+.

```bash
npm install -g github-mcp-sketch
```

You'll need a GitHub Personal Access Token (fine-grained, read-only is enough). [Create one](https://github.com/settings/personal-access-tokens/new) with content and metadata read on whatever repos you'll use it against.

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_PAT` | yes | — | Bearer token forwarded as the `Authorization` header on every upstream request. |
| `UPSTREAM_MCP_URL` | no | `https://api.githubcopilot.com/mcp` | Upstream MCP endpoint. Override for testing or self-hosted GitHub MCPs. |
| `CACHE_SIZE` | no | `50` | Max number of cached responses kept in memory before LRU eviction. Each cached entry is one upstream tool result. |
| `METRICS_CSV` | no | *(off)* | If set to a file path, the proxy appends per-tool-call metrics (raw vs sketched response size, tokens, timing) to that CSV. Off by default — set it explicitly to opt in. |

How the variables get set depends on how you launch the proxy:

- **From an MCP host** (Claude Code, Claude Desktop, Cline, etc.) — the host passes env vars to the spawned process. In Claude Code that's the `-e KEY=VALUE` flag of `claude mcp add` (shown below). Values are stored in the host's MCP config (`~/.claude.json` for Claude Code).
- **Direct shell invocation** — `GITHUB_PAT=ghp_... github-mcp-sketch`, or export the variable in your shell rc.
- **Running from a clone of the source** — copy `.env.example` → `.env`, fill it in. Dotenv loads it on startup. (`.env` is gitignored.)

## Wire into Claude Code

Minimal — just the required PAT:

```bash
claude mcp add github-sketch \
  -e GITHUB_PAT=<your_pat> \
  -- npx github-mcp-sketch
```

With optional variables — stack additional `-e KEY=VALUE` flags before the `--`:

```bash
claude mcp add github-sketch \
  -e GITHUB_PAT=<your_pat> \
  -e CACHE_SIZE=200 \
  -e METRICS_CSV=/tmp/github-sketch-metrics.csv \
  -- npx github-mcp-sketch
```

All `-e` values are persisted in `~/.claude.json` and passed to the proxy on every spawn.

Verify the server is registered:

```bash
claude mcp list | grep github-sketch
# github-sketch: npx github-mcp-sketch - ✓ Connected
```

Restart Claude Code so the new server is registered.

### Changing variables after wire-up

Claude Code doesn't expose an in-place edit for MCP env vars. To change one:

```bash
claude mcp remove github-sketch
claude mcp add github-sketch -e GITHUB_PAT=<new_pat> -- npx github-mcp-sketch
```

Or edit `~/.claude.json` directly under the `mcpServers.github-sketch.env` block.

## Wire into Codex

Add the server to your Codex config at `~/.codex/config.toml`.

Minimal — just the required PAT:

```toml
[mcp_servers.github-sketch]
command = "npx"
args = ["github-mcp-sketch"]

[mcp_servers.github-sketch.env]
GITHUB_PAT = "<your_pat>"
```

With optional variables:

```toml
[mcp_servers.github-sketch]
command = "npx"
args = ["github-mcp-sketch"]

[mcp_servers.github-sketch.env]
GITHUB_PAT = "<your_pat>"
CACHE_SIZE = "200"
METRICS_CSV = "/tmp/github-sketch-metrics.csv"
```

If you installed the package globally, you can launch the binary directly instead:

```toml
[mcp_servers.github-sketch]
command = "github-mcp-sketch"
args = []

[mcp_servers.github-sketch.env]
GITHUB_PAT = "<your_pat>"
```

Restart Codex after editing `~/.codex/config.toml` so the new MCP server is registered. The server should then appear as `github-sketch` and expose the upstream GitHub tools plus `query_response`.

## Wire into other MCP hosts

The proxy is a standard stdio MCP — anything that speaks MCP can host it. The general pattern:

- Spawn `npx github-mcp-sketch` as a stdio process
- Pass env vars (at minimum `GITHUB_PAT`) on that spawn

For example, in a custom Anthropic SDK app using `@modelcontextprotocol/sdk`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["github-mcp-sketch"],
  env: {
    ...process.env,
    GITHUB_PAT: process.env.GITHUB_PAT!,
    CACHE_SIZE: "100",  // optional
  },
});
const client = new Client({ name: "my-app", version: "0.1.0" });
await client.connect(transport);
```

Verify:

```bash
claude mcp list | grep github-sketch
# github-sketch: node /.../dist/server.js - ✓ Connected
```

Restart Claude Code so the new server is registered. The proxy exposes the same tool names as the upstream GitHub MCP (`list_issues`, `pull_request_read`, `get_file_contents`, etc.) plus the added `query_response`.

## Tools

The proxy passes through every tool from the upstream GitHub MCP with identical names, descriptions, and input schemas. The agent calls them exactly as it would call the upstream MCP.

The one added tool:

### `query_response(cache_id, path, max_items?)`

Extract values from a response cached by a previous tool call.

**Path syntax:**

| Path | Returns |
|---|---|
| `""` (empty string) | The whole cached value |
| `"user.login"` | A nested scalar |
| `"[0].title"` | First array item's field |
| `"[*].title"` | A field from every array item |
| `"items[*].user.login"` | Nested field across an array |

**Batch mode** — pass an array of paths to get multiple fields in one call:

```
path=["items[*].number", "items[*].title", "items[*].state"]
```

Returns `{ results: { "items[*].number": [...], "items[*].title": [...], ... } }`. Per-path errors are reported in that path's entry; other paths still succeed.

**`max_items`** — optional cap on items returned per wildcard expansion. Defaults to unlimited; the agent only sets it when it explicitly wants a sample.

## When it doesn't help

Looking at the per-tier table above:

- **Single-object fetches of small objects** (one issue, one user) — the agent queries back most of the fields anyway, so the schema + query overhead exceeds the per-call wire savings.
- **File contents** — raw file text isn't structured, so there's no schema noise to skip. The proxy passes the file through with minor envelope savings only.
- **Tasks where the agent really does need every field** — almost never happens for list and search endpoints, but is the failure mode if it does.

Known variance: on `t3-06` (a 67-comment review thread on a Kubernetes KEP), one of three sketch runs occasionally consumes ~60K context (vs ~39K median) because the agent issues a doubly-nested wildcard query (`review_threads[*].comments[*].body`) that materializes most of the original payload. The median is still ~56% better than baseline, but this is a real pattern the agent can fall into. The proxy doesn't currently guard against it.

## Reproduce the bench

The benchmark is a separate repo: [`json-schema-sketch-bench`](https://github.com/markadelnawar/json-schema-sketch-bench).

```bash
git clone https://github.com/markadelnawar/json-schema-sketch-bench
cd json-schema-sketch-bench
npm install
cp .env.example .env  # add ANTHROPIC_API_KEY and GITHUB_PAT
npm run bench   # 13 cases × 2 sides × 3 runs, ~45 min, ~$5-10
npm run report  # generates summary.md
```

Cases, raw CSVs, methodology details, and the final `summary.md` from a recent run are all checked in.

## Architecture

The proxy is a thin stdio MCP server:

- Connects to `https://api.githubcopilot.com/mcp` over Streamable HTTP using the agent-provided `GITHUB_PAT`.
- On startup, calls upstream `listTools()` and registers each tool with its original name and description. Adds `query_response` to the manifest.
- On `tools/call`: if the name is `query_response`, resolves the path against the cache; otherwise forwards upstream, caches the parsed JSON, infers the schema, and returns the wrapped response.

There's no rate limiting, no retry, no auth refresh. Upstream errors are returned verbatim.

## Caveats

- **Stateful in memory.** Cache entries live until the proxy process exits. Restart Claude Code = empty cache.
- **One PAT per process.** The proxy reads `GITHUB_PAT` once at startup. To rotate, restart.
- **Schemas drop list-element variance.** If items in an array have different shapes, the schema picks a representative one. Rarely a problem for GitHub responses but can be surprising.
- **No write-tool optimization.** Tools that perform writes (`create_issue`, `merge_pull_request`) work but the response sketching is wasted on small confirmation payloads.

## License

MIT. See [LICENSE](LICENSE).

## Related

- [`json-schema-sketch`](https://github.com/markadelnawar/json-schema-sketch) — the underlying library that infers compact text-form schemas from JSON values.
- [`json-schema-sketch-bench`](https://github.com/markadelnawar/json-schema-sketch-bench) — the benchmark harness used to produce the numbers above.
- [GitHub MCP server](https://github.com/github/github-mcp-server) — the upstream this proxies.
- [Model Context Protocol](https://modelcontextprotocol.io) — the protocol both speak.
