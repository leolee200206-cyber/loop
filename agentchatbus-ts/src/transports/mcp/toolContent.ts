import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Tool data arrays (agents, threads, etc.) are not automatically MCP content blocks. */
export function toMcpContent(result: unknown): CallToolResult["content"] {
  if (Array.isArray(result) && result.length > 0 && CallToolResultSchema.safeParse({ content: result }).success) {
    return result as CallToolResult["content"];
  }
  return [{ type: "text", text: JSON.stringify(result) ?? "null" }];
}
