export interface McpErrorResponse {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  [k: string]: unknown;
}

export function buildToolError(message: string): McpErrorResponse {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
