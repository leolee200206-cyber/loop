import spawn from "cross-spawn";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUS_VERSION, getConfig } from "../config/env.js";
import { detectAllAgentStatuses } from "./acpStatus.js";
import { resolveLocalCommand } from "./nativeCommand.js";

const PROVIDERS = [
  { id: "codex", name: "Codex", command: "codex", route: "native-or-mcp", client_type: "cli" },
  { id: "grok", name: "Grok Build", command: "grok", route: "native-acp", client_type: "cli" },
  { id: "gemini", name: "Gemini CLI", command: "gemini", route: "mcp", client_type: "cli" },
  { id: "claude", name: "Claude Code", command: "claude", route: "native-or-mcp", client_type: "cli" },
  { id: "muse", name: "Muse", command: "muse", route: "external-mcp", client_type: "external" },
  { id: "antigravity", name: "Antigravity Desktop", command: null, route: "desktop-mcp", client_type: "desktop" },
  { id: "opencode", name: "OpenCode Desktop", command: null, route: "desktop-mcp", client_type: "desktop" },
] as const;

function desktopExecutable(id: string): string | null {
  if (process.platform !== "win32") return null;
  const installation = id === "opencode" ? ["@opencodedesktop", "OpenCode.exe"] : ["antigravity", "Antigravity.exe"];
  const path = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", ...installation);
  return existsSync(path) ? path : null;
}

function desktopConfigured(id: string, mcpUrl: string): boolean {
  try {
    const path = id === "opencode"
      ? join(homedir(), ".config", "opencode", "opencode.json")
      : join(homedir(), ".gemini", "config", "mcp_config.json");
    const config = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const server = id === "opencode" ? config?.mcp?.servers?.agentchatbus : config?.mcpServers?.agentchatbus;
    if (server?.disabled === true) return false;
    if (id === "opencode" && server?.type !== "remote") return false;
    const url = server?.serverUrl ?? server?.url;
    return typeof url === "string" && url.replace(/\/+$/, "") === mcpUrl.replace(/\/+$/, "");
  } catch { return false; }
}

const versionCache = new Map<string, { at: number; version: string | null; error: string | null }>();
const pendingVersions = new Map<string, Promise<{ version: string | null; error: string | null }>>();

function readVersion(command: string): Promise<{ version: string | null; error: string | null }> {
  const cached = versionCache.get(command);
  if (cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached);
  const pending = pendingVersions.get(command);
  if (pending) return pending;
  const result = new Promise<{ version: string | null; error: string | null }>(resolve => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    const child = spawn(command, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const done = (version: string | null, error: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      versionCache.set(command, { at: Date.now(), version, error });
      resolve({ version, error });
    };
    const timer = setTimeout(() => {
      child.kill();
      done(null, "Version check timed out; installation alone does not prove compatibility.");
    }, 2500);
    child.stdout?.on("data", chunk => { stdout = (stdout + String(chunk)).slice(0, 4096); });
    child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(0, 4096); });
    child.once("error", () => done(null, "Executable could not be started."));
    child.once("exit", code => {
      const text = (stdout || stderr).replace(/\x1b\[[0-9;]*m/g, "").trim();
      const version = text.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b/)?.[0] ?? null;
      done(code === 0 ? version : null, code === 0 && version ? null : "CLI version could not be verified.");
    });
  });
  pendingVersions.set(command, result);
  void result.finally(() => pendingVersions.delete(command));
  return result;
}

export interface IntegrationPeer { ide?: string; is_online?: boolean; }

/** Read-only diagnostics. Only inspect the named MCP endpoint, never return credentials. */
export async function getIntegrationStatus(peers: IntegrationPeer[] = []) {
  const acp = detectAllAgentStatuses();
  const config = getConfig();
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  const origin = `http://${host.includes(":") ? `[${host}]` : host}:${config.port}`;
  const providers = await Promise.all(PROVIDERS.map(async provider => {
    const executable = provider.command ? resolveLocalCommand(provider.command) : desktopExecutable(provider.id);
    // Never launch a desktop application merely to probe its version.
    const probe = executable && provider.command ? await readVersion(executable) : { version: null, error: null };
    const acpEntry = acp.agents.find(item => item.id === provider.id);
    const registered = peers.filter(peer => String(peer.ide || "").toLowerCase().includes(provider.id));
    const active = registered.filter(peer => peer.is_online).length;
    return {
      ...provider, installed: executable !== null, executable, version: probe.version,
      version_error: probe.error, registered_sessions: active,
      total_registered_sessions: registered.length,
      acp_available: acpEntry?.status === "available",
      acp_enabled: acpEntry?.enabled ?? false,
      native_acp: provider.id === "grok" && Boolean(executable),
      // A mailbox/online registration is not proof that a harness can wake up.
      delivery: "pull" as const, idle_wakeup_verified: false,
      configuration_verified: provider.client_type === "desktop" && desktopConfigured(provider.id, `${origin}/mcp`),
    };
  }));
  return {
    checked_at: new Date().toISOString(), version: BUS_VERSION,
    mcp_url: `${origin}/mcp`, web_url: `${origin}/static/index.html`,
    providers, online_agents: peers.filter(peer => peer.is_online).length,
    local_data_dir: config.appDir,
    build: { base_commit: "63d89ca", base_date: "2026-08-23T18:28:46Z", local_revision: "local-integration-2", local_date: "2026-11-08" },
    reference_projects: [
      { name: "Concord MCP", repository: "https://github.com/Get-Concord-AI/concord-mcp", commit: "6e39ff0562f95c8fc89992a9ef512846a29e7212", updated_at: "2026-11-05T18:48:01Z", inspected: "Capability contracts, local adapters and delivery diagnostics" },
      { name: "cross-agent MCP", repository: "https://github.com/whooperlove/cross-agent_mcp", commit: "c1b0e5428863b0df78fbe587a8510f6ab0a507ec", updated_at: "2026-11-05T00:54:50Z", inspected: "Session routing, busy locks and context-preserving delivery" },
      { name: "agentchattr", repository: "https://github.com/bcurts/agentchattr", commit: "ff8d22e01eb57ef543d07556773ead5b2257c63a", updated_at: "2026-10-24T05:19:55Z", inspected: "Shared channels, explicit mentions and bounded agent loops" },
    ],
  };
}
