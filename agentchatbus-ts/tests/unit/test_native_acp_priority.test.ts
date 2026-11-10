import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/core/services/nativeCommand.js", () => ({
  resolveNativeAcpCommand: (id: string) => id === "grok"
    ? { command: "C:\\Users\\Test User\\.grok\\bin\\grok.exe", args: ["agent", "stdio"] }
    : null,
}));
import { resolveAcpSpawnCommand } from "../../src/core/services/acpRegistry.js";

describe("native ACP priority", () => {
  it("uses an existing native Grok instead of npx and the pinned old package", () => {
    expect(resolveAcpSpawnCommand("grok")).toEqual({
      command: "C:\\Users\\Test User\\.grok\\bin\\grok.exe", args: ["agent", "stdio"],
    });
  });
  it("preserves the wrapper fallback for clients without a verified native contract", () => {
    const result = resolveAcpSpawnCommand("claude")!;
    expect(result.command).toMatch(/^npx(\.cmd)?$/);
    expect(result.args[0]).toBe("-y");
    expect(result.args[1]).toContain("claude-agent-acp");
  });
});
