import { describe, expect, it } from "vitest";
import { resolveLocalCommand } from "../../src/core/services/nativeCommand.js";

describe("local executable discovery", () => {
  it("finds Grok outside PATH in the standard Windows install directory", () => {
    const expected = "C:\\Users\\Test User\\.grok\\bin\\grok.exe";
    expect(resolveLocalCommand("grok", { platform: "win32", home: "C:\\Users\\Test User", env: { PATH: "" }, isFile: p => p === expected })).toBe(expected);
  });
  it("preserves spaces in a Windows command path without shell parsing", () => {
    const expected = "C:\\Program Files\\Tools\\codex.exe";
    expect(resolveLocalCommand("codex", { platform: "win32", env: { PATH: '"C:\\Program Files\\Tools"' }, isFile: p => p === expected })).toBe(expected);
  });
  it("does not search the working directory via an empty PATH entry", () => {
    const visited: string[] = [];
    resolveLocalCommand("grok", { platform: "win32", home: "C:\\Users\\Test", env: { PATH: ";.;;" }, isFile: p => { visited.push(p); return false; } });
    expect(visited.every(p => p.startsWith("C:\\"))).toBe(true);
  });
  it("fails an invalid explicit override instead of running a different command", () => {
    expect(resolveLocalCommand("grok", { platform: "win32", env: { AGENTCHATBUS_GROK_COMMAND: "grok --always-approve" }, isFile: () => true })).toBeNull();
  });
  it("uses an absolute explicit override exactly", () => {
    const expected = "E:\\Agents\\grok.exe";
    expect(resolveLocalCommand("grok", { platform: "win32", env: { AGENTCHATBUS_GROK_COMMAND: expected }, isFile: p => p === expected })).toBe(expected);
  });
  it("finds a Unix user-installed command", () => {
    expect(resolveLocalCommand("claude", { platform: "linux", home: "/home/test", env: { PATH: "" }, isFile: p => p === "/home/test/.local/bin/claude" })).toBe("/home/test/.local/bin/claude");
  });
  it("rejects a command line or path supplied as a provider name", () => {
    expect(resolveLocalCommand("grok;echo unexpected")).toBeNull();
    expect(resolveLocalCommand("../grok")).toBeNull();
  });
});
