import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn(() => "{}") }));
vi.mock("../../src/core/services/nativeCommand.js", () => ({ resolveLocalCommand: () => null }));
vi.mock("../../src/core/services/acpStatus.js", () => ({ detectAllAgentStatuses: () => ({ agents: [] }) }));
vi.mock("../../src/core/config/env.js", () => ({ BUS_VERSION: "test", getConfig: () => ({ host: "0.0.0.0", port: 39765, appDir: "E:\\AgentChatBus\\data" }) }));
import { getIntegrationStatus } from "../../src/core/services/integrationStatus.js";

describe("honest connection diagnostics", () => {
  beforeEach(() => { vi.mocked(existsSync).mockReturnValue(false); vi.mocked(readFileSync).mockReturnValue("{}"); });
  it("lists requested CLI and desktop clients without claiming they are installed or connected", async () => {
    const result = await getIntegrationStatus();
    expect(result.providers.map(p => p.id)).toEqual(["codex", "grok", "gemini", "claude", "muse", "antigravity", "opencode"]);
    for (const provider of result.providers) {
      expect(provider.installed).toBe(false);
      expect(provider.configuration_verified).toBe(false);
      expect(provider.idle_wakeup_verified).toBe(false);
      expect(provider.registered_sessions).toBe(0);
    }
  });
  it("keeps an idle desktop registration visible without claiming it is online", async () => {
    const result = await getIntegrationStatus([{ ide: "Antigravity Desktop", is_online: false }]);
    const desktop = result.providers.find(p => p.id === "antigravity")!;
    expect(desktop.client_type).toBe("desktop");
    expect(desktop.total_registered_sessions).toBe(1);
    expect(desktop.registered_sessions).toBe(0);
    expect(desktop.idle_wakeup_verified).toBe(false);
  });
  it("verifies the actual desktop MCP endpoint without exposing configuration secrets", async () => {
    vi.mocked(readFileSync).mockReturnValue('\uFEFF' + JSON.stringify({ mcpServers: { agentchatbus: { serverUrl: "http://127.0.0.1:39765/mcp/", headers: { Authorization: "private-test-value" } } } }));
    const result = await getIntegrationStatus();
    expect(result.providers.find(p => p.id === "antigravity")!.configuration_verified).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-test-value");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ mcpServers: { agentchatbus: { serverUrl: "http://127.0.0.1:9999/mcp" } } }));
    expect((await getIntegrationStatus()).providers.find(p => p.id === "antigravity")!.configuration_verified).toBe(false);
  });
  it("tolerates invalid desktop configuration", async () => {
    vi.mocked(readFileSync).mockReturnValue("invalid json");
    expect((await getIntegrationStatus()).providers.find(p => p.id === "antigravity")!.configuration_verified).toBe(false);
  });
  it("recognizes OpenCode V2 remote MCP configuration and real desktop registrations", async () => {
    vi.mocked(readFileSync).mockImplementation((path: unknown) => String(path).includes("opencode.json")
      ? JSON.stringify({ mcp: { servers: { agentchatbus: { type: "remote", url: "http://127.0.0.1:39765/mcp" } } } }) : "{}");
    const desktop = (await getIntegrationStatus([{ ide: "OpenCode Desktop", is_online: true }])).providers.find(p => p.id === "opencode")!;
    expect(desktop.client_type).toBe("desktop");
    expect(desktop.configuration_verified).toBe(true);
    expect(desktop.registered_sessions).toBe(1);
    expect(desktop.total_registered_sessions).toBe(1);
  });
  it("does not report a disabled OpenCode MCP entry as configured", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ mcp: { servers: { agentchatbus: { type: "remote", disabled: true, url: "http://127.0.0.1:39765/mcp" } } } }));
    expect((await getIntegrationStatus()).providers.find(p => p.id === "opencode")!.configuration_verified).toBe(false);
  });
  it("online registration never upgrades idle-delivery capability", async () => {
    const result = await getIntegrationStatus([{ ide: "Codex", is_online: true }, { ide: "Grok", is_online: false }]);
    const codex = result.providers.find(p => p.id === "codex")!;
    expect(codex.registered_sessions).toBe(1);
    expect(codex.delivery).toBe("pull");
    expect(codex.idle_wakeup_verified).toBe(false);
    expect(result.online_agents).toBe(1);
  });
  it("uses a reachable loopback endpoint rather than a bind-all address", async () => {
    expect((await getIntegrationStatus()).mcp_url).toBe("http://127.0.0.1:39765/mcp");
  });
});
