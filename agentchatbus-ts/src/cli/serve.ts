import { startHttpServer } from "../transports/http/server.js";
import { startSocketServer, getAgentSocketPath } from "../transports/socket/server.js";
import { getConfig } from "../core/config/env.js";
import { logInfo } from "../shared/logger.js";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAcpSocketProxyScript } from "../core/services/acpMcpProxyPath.js";

/**
 * In V2 mode, copy the proxy script to the shared app directory so that
 * agent MCP configs can reference a stable path (~/.agentchatbus/proxy.mjs)
 * regardless of which IDE extension is running the daemon.
 */
function ensureProxyScriptInAppDir(): string | null {
  try {
    const config = getConfig();
    const targetPath = join(config.appDir, "proxy.mjs");
    // The CLI bundle is CJS: resolve assets from the actual entry path,
    // not import.meta.url, which is empty after bundling.
    const candidate = resolveAcpSocketProxyScript();
    if (!existsSync(targetPath) || readFileSync(candidate, "utf-8") !== readFileSync(targetPath, "utf-8")) {
      copyFileSync(candidate, targetPath);
      logInfo(`[v2] Copied proxy script to ${targetPath}`);
    }
    return targetPath;
  } catch (err) {
    logInfo(`[v2] Warning: failed to copy proxy script: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function runServe(): Promise<void> {
  const config = getConfig();
  const server = await startHttpServer();
  const address = server.addresses().map((entry) => `${entry.address}:${entry.port}`).join(", ");
  logInfo(`serve mode listening on ${address}`);

  // V2: start the socket server for agent connections (no IP/port needed).
  // The HTTP server remains for the Web UI backend and is not affected.
  if (config.agentTransport === "v2-socket") {
    const sockPath = getAgentSocketPath();
    startSocketServer(sockPath);
    logInfo(`serve mode v2 agent transport on ${sockPath}`);
    // Copy proxy script to shared app dir for stable agent MCP config paths.
    ensureProxyScriptInAppDir();
  } else {
    logInfo(`serve mode v1 agent transport (HTTP) on ${address}/mcp`);
  }
}
