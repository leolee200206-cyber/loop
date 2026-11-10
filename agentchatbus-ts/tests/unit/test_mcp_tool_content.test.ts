import { describe, expect, it } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { toMcpContent } from "../../src/transports/mcp/toolContent.js";

describe("MCP result content compatibility", () => {
  it("serializes agent data arrays into valid JSON text blocks", () => {
    const agents = [{ id: "desktop-1", ide: "Antigravity Desktop", is_online: false }];
    const content = toMcpContent(agents);
    expect(CallToolResultSchema.safeParse({ content }).success).toBe(true);
    expect(content).toEqual([{ type: "text", text: JSON.stringify(agents) }]);
  });
  it("preserves legitimate mixed MCP text and image blocks", () => {
    const blocks = [{ type: "text", text: "message" }, { type: "image", data: "AA==", mimeType: "image/png" }];
    expect(toMcpContent(blocks)).toBe(blocks);
  });
  it("retains empty list data rather than hiding it as empty content", () => {
    expect(toMcpContent([])).toEqual([{ type: "text", text: "[]" }]);
  });
  it("does not mistake a data row with a type field for a valid block", () => {
    const rows = [{ type: "text", id: "row" }];
    expect(toMcpContent(rows)).toEqual([{ type: "text", text: JSON.stringify(rows) }]);
  });
});
