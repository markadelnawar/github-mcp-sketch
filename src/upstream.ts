import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface UpstreamCallResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  [k: string]: unknown;
}

export class UpstreamMcp {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  constructor(url: string, pat: string) {
    this.transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${pat}` },
      },
    });
    this.client = new Client(
      { name: "github-mcp-sketch", version: "0.0.1" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: unknown): Promise<UpstreamCallResult> {
    const result = await this.client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
    return result as UpstreamCallResult;
  }
}
