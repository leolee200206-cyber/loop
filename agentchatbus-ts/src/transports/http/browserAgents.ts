import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MemoryStore } from "../../core/services/memoryStore.js";
import type { AgentRecord } from "../../core/types/models.js";
import { SeqMismatchError, BusError } from "../../core/types/errors.js";

const BROWSER_CAPABILITY = "browser-ui";
const HEARTBEAT_INTERVAL = 20_000;
const IDENTITY_COOKIE = "acb_browser_identity";
const COOKIE_PATH = "/api/browser-agents";
type Body = Record<string, unknown>;

export function browserAgentPresentation(agent: AgentRecord) {
  return {
    id: agent.id,
    display_name: agent.display_name || agent.name,
    name: agent.name,
    ide: agent.ide,
    model: agent.model,
    emoji: agent.emoji,
    is_online: agent.is_online,
    last_heartbeat: agent.last_heartbeat,
    capabilities: agent.capabilities,
    connection_type: "browser",
    presence_semantics: "web_session",
  };
}

// Agent lifecycle events originate from private store records. Never publish
// their credentials on the browser SSE channel.
export function publicBrowserEvent(event: Record<string, unknown>) {
  if (!String(event.type || "").startsWith("agent.")) return event;
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, "token")) return event;
  const { token: _privateToken, ...publicPayload } = payload;
  return { ...event, payload: publicPayload };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function isSecureRequest(request: FastifyRequest): boolean {
  const xf = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  if (xf.split(",").map(s => s.trim()).includes("https")) return true;
  const proto = (request as any).protocol;
  if (proto === "https") return true;
  return !!(request.raw.socket as any)?.encrypted;
}

function serializeIdentityCookie(agentId: string, token: string, secure: boolean): string {
  const value = `${encodeURIComponent(agentId)}.${encodeURIComponent(token)}`;
  const attrs = [
    `${IDENTITY_COOKIE}=${value}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=2592000", // finite recovery window; explicit leave clears cookie
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function clearIdentityCookie(secure: boolean): string {
  const attrs = [
    `${IDENTITY_COOKIE}=`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function readCookieIdentity(request: FastifyRequest): { agentId: string; token: string } | null {
  const cookies = parseCookies(request.headers.cookie);
  const raw = cookies[IDENTITY_COOKIE];
  if (!raw) return null;
  const idx = raw.indexOf(".");
  if (idx <= 0) return null;
  try {
    const agentId = decodeURIComponent(raw.slice(0, idx));
    const token = decodeURIComponent(raw.slice(idx + 1));
    if (!agentId || !token) return null;
    return { agentId, token };
  } catch {
    return null;
  }
}

type IdentitySource = "header" | "cookie" | "none";
function readCredential(request: FastifyRequest): { agentId?: string; token?: string; source: IdentitySource } {
  const hId = request.headers["x-agent-id"];
  const hToken = request.headers["x-agent-token"];
  if (hId !== undefined || hToken !== undefined) {
    return { agentId: typeof hId === "string" ? hId : undefined, token: typeof hToken === "string" ? hToken : undefined, source: "header" };
  }
  const cookie = readCookieIdentity(request);
  if (cookie) return { ...cookie, source: "cookie" };
  return { source: "none" };
}

export function registerBrowserAgentRoutes(server: FastifyInstance, store: MemoryStore): void {
  const prefix = "/api/browser-agents";
  const registerAgent = store.registerAgent.bind(store) as (input: {
    ide: string; model: string; description?: string; capabilities?: string[]; display_name?: string; emoji?: string;
  }) => AgentRecord;

  server.addHook("onRequest", async (request, reply) => {
    if (!String(request.url || "").startsWith(prefix)) return;
    reply.header("Cache-Control", "no-store");
  });

  function rejectCrossOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
    if (!origin) return false;
    try {
      const host = String(request.headers.host || "").trim().toLowerCase();
      const originHost = new URL(origin).host.trim().toLowerCase();
      if (host && originHost && host !== originHost) {
        reply.code(403).send({ error: "CROSS_ORIGIN_FORBIDDEN", detail: "Cross-origin browser-agent request rejected." });
        return true;
      }
    } catch {
      reply.code(403).send({ error: "CROSS_ORIGIN_FORBIDDEN", detail: "Invalid origin." });
      return true;
    }
    return false;
  }

  function resolveCredential(request: FastifyRequest): { agent: AgentRecord; canonical: AgentRecord; migratedFromRetired: boolean; source: IdentitySource } | null {
    const cred = readCredential(request);
    if (!cred.agentId || !cred.token) return null;
    const resolved = (store as any).getAgentForBrowserCredential
      ? (store as any).getAgentForBrowserCredential(cred.agentId, cred.token)
      : (() => {
          const a = store.getAgent(cred.agentId!);
          if (!a || !a.token || a.token !== cred.token) return undefined;
          return { agent: a, canonical: a, migratedFromRetired: false };
        })();
    if (!resolved) return null;
    return { ...resolved, source: cred.source };
  }

  function auth(request: FastifyRequest, reply: FastifyReply): { agent: AgentRecord; canonical: AgentRecord; source: IdentitySource } | null {
    const resolved = resolveCredential(request);
    const caps = resolved ? (Array.isArray(resolved.canonical.capabilities) ? resolved.canonical.capabilities : []) : [];
    if (!resolved || !caps.includes(BROWSER_CAPABILITY)) {
      reply.code(401).send({ error: "INVALID_BROWSER_IDENTITY", detail: "网页身份无效或已过期，请重新加入或恢复。" });
      return null;
    }
    // Refresh/establish cookie for valid sessions (same-browser recovery and
    // one-time migration of legacy header/sessionStorage creds). Header-token
    // clients remain compatible; cookie is HttpOnly and not exposed to JS.
    // A late heartbeat from a previous tab must not overwrite a newer shared
    // identity cookie. Establish it only for legacy/alias migration.
    if (resolved.source === "header" || resolved.migratedFromRetired) {
      reply.header("Set-Cookie", serializeIdentityCookie(resolved.canonical.id, resolved.canonical.token!, isSecureRequest(request)));
    }
    return { agent: resolved.agent, canonical: resolved.canonical, source: resolved.source };
  }

  function openThread(threadId: string | undefined, reply: FastifyReply) {
    const thread = threadId ? store.getThread(threadId) : undefined;
    if (!thread) { reply.code(404).send({ detail: "Thread not found" }); return; }
    if (thread.status === "archived" || thread.status === "closed") {
      reply.code(409).send({ error: "THREAD_NOT_OPEN", detail: "该讨论当前不可加入。" });
      return;
    }
    return thread.id;
  }

  server.post(`${prefix}/join`, async (request, reply) => {
    if (rejectCrossOrigin(request, reply)) return;
    const body = (request.body || {}) as Body;
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    const wantsNew = body.create_new === true || body.confirm_new_identity === true;
    const confirmDifferentIdentity = body.confirm_different_identity === true;
    const recoverOnly = body.recover_only === true;

    // 1) Existing valid identity (cookie or header): recover, do not create.
    const existing = resolveCredential(request);
    if (existing) {
      const caps = Array.isArray(existing.canonical.capabilities) ? existing.canonical.capabilities : [];
      if (!caps.includes(BROWSER_CAPABILITY)) {
        return reply.code(401).send({ error: "INVALID_BROWSER_IDENTITY", detail: "网页身份无效或已过期，请重新加入或恢复。" });
      }
      const threadId = openThread(typeof body.thread_id === "string" ? body.thread_id : undefined, reply);
      if (!threadId) return;
      store.addThreadParticipant(threadId, existing.canonical.id);
      store.setAgentOnlineState(existing.canonical.id, true, "browser_join");
      reply.header("Set-Cookie", serializeIdentityCookie(existing.canonical.id, existing.canonical.token!, isSecureRequest(request)));
      return {
        agent: browserAgentPresentation(existing.canonical),
        // Keep header compatibility: token not returned on resume.
        ...(existing.source === "header" && !readCookieIdentity(request) ? {} : {}),
        heartbeat_interval_ms: HEARTBEAT_INTERVAL,
        migrated_from_retired: existing.migratedFromRetired || undefined,
        recovered: true,
      };
    }

    // If caller presented credentials but they are invalid, never silently create.
    const presented = readCredential(request);
    if (presented.source !== "none") {
      reply.header("Set-Cookie", clearIdentityCookie(isSecureRequest(request)));
      return reply.code(401).send({ error: "INVALID_BROWSER_IDENTITY", detail: "网页身份无效或已过期，请重新加入或恢复。" });
    }

    if (recoverOnly) {
      return reply.code(401).send({ error: "RECOVERY_REQUIRED", detail: "没有可恢复的浏览器身份凭据。请使用原浏览器会话恢复，或明确创建新身份。" });
    }

    // 2) New identity creation (no credentials). Validate input first.
    if (!displayName || displayName.length > 60 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      return reply.code(400).send({ detail: "display_name required (max 60 chars, no control characters)" });
    }
    const threadId = openThread(typeof body.thread_id === "string" ? body.thread_id : undefined, reply);
    if (!threadId) return;

    // Same-name existing identity: do not auto-claim, do not default duplicate.
    // Recurrence guard: when same-name browser identities exist, recovery is the
    // safe default. Creating a DIFFERENT independent identity with the same
    // display name is allowed only with explicit confirm_different_identity=true
    // (prevents accidental duplicate seats from confused/conflict flows). This
    // does NOT merge by nickname and does NOT block truly different identities.
    const sameName = typeof (store as any).findBrowserIdentitiesByDisplayName === "function"
      ? (store as any).findBrowserIdentitiesByDisplayName(displayName) as AgentRecord[]
      : [];
    const activeSameName = sameName.filter(a => !a.browser_identity_canonical_id);
    if (activeSameName.length > 0 && !wantsNew) {
      return reply.code(409).send({
        error: "BROWSER_IDENTITY_EXISTS",
        detail: "检测到同名网页身份。若这是同一浏览器身份，请恢复原会话；若确认为不同独立身份，请明确选择“创建不同独立身份”。系统不会自动认领或自动复用他人身份。",
        display_name: displayName,
        requires_explicit_choice: true,
        choices: ["recover_existing", "confirm_different_identity"],
        existing_count: activeSameName.length,
      });
    }
    if (activeSameName.length > 0 && wantsNew && !confirmDifferentIdentity) {
      return reply.code(409).send({
        error: "BROWSER_IDENTITY_CREATE_CONFIRMATION_REQUIRED",
        detail: "检测到同名网页身份。为避免误建重复席位，创建不同独立身份前必须明确确认。若这是同一浏览器身份，请恢复原会话；若确认为不同真人/不同独立身份，请使用 confirm_different_identity 明确创建。",
        display_name: displayName,
        requires_explicit_choice: true,
        choices: ["recover_existing", "confirm_different_identity"],
        existing_count: activeSameName.length,
      });
    }

    const provider = typeof body.provider === "string" ? body.provider.trim().slice(0, 80) : "";
    const agent = registerAgent({
      ide: "Browser",
      model: provider ? `Browser Agent (${provider})` : "Browser Agent",
      description: "Independent browser-agent identity",
      capabilities: [BROWSER_CAPABILITY, "chat"],
      display_name: displayName,
    });
    store.addThreadParticipant(threadId, agent.id);
    store.setAgentOnlineState(agent.id, true, "browser_join");
    reply.header("Set-Cookie", serializeIdentityCookie(agent.id, agent.token!, isSecureRequest(request)));
    return {
      agent: browserAgentPresentation(agent),
      // Backward-compatible: initial join returns token in body for header-token
      // clients/tests. Frontend v2 must not persist it in localStorage/URL/logs
      // and should rely on HttpOnly cookie.
      ...(!wantsNew && activeSameName.length === 0 ? { token: agent.token } : { token: agent.token }),
      heartbeat_interval_ms: HEARTBEAT_INTERVAL,
      created_new: true,
      ...(activeSameName.length > 0 ? { created_as_different_identity: true } : {}),
    };
  });

  server.get(`${prefix}/session`, async (request, reply) => {
    const ident = auth(request, reply);
    if (!ident) return;
    return { agent: browserAgentPresentation(ident.canonical), heartbeat_interval_ms: HEARTBEAT_INTERVAL };
  });

  server.post(`${prefix}/heartbeat`, async (request, reply) => {
    const ident = auth(request, reply);
    if (!ident) return;
    const body = (request.body || {}) as Body;
    const leaseId = typeof body.lease_id === "string" ? body.lease_id : (typeof request.headers["x-browser-lease-id"] === "string" ? request.headers["x-browser-lease-id"] : "");
    if (leaseId && typeof (store as any).setBrowserLease === "function") {
      (store as any).setBrowserLease(ident.canonical.id, leaseId);
    } else {
      store.setAgentOnlineState(ident.canonical.id, true, "browser_heartbeat");
    }
    const current = store.getAgent(ident.canonical.id) || ident.canonical;
    return { ok: true, agent: browserAgentPresentation(current) };
  });

  server.post(`${prefix}/leave`, async (request, reply) => {
    const ident = auth(request, reply);
    if (!ident) return;
    const body = (request.body || {}) as Body;
    if (body.expected_agent_id !== undefined && body.expected_agent_id !== ident.canonical.id) return reply.code(409).send({ error: "BROWSER_IDENTITY_MISMATCH" });
    const leaseId = typeof body.lease_id === "string" ? body.lease_id : (typeof request.headers["x-browser-lease-id"] === "string" ? request.headers["x-browser-lease-id"] : "");
    const explicit = body.explicit_leave === true || body.all_tabs === true || !leaseId;
    if (leaseId && !explicit && typeof (store as any).clearBrowserLease === "function") {
      const r = (store as any).clearBrowserLease(ident.canonical.id, leaseId) as { hasFreshLease: boolean };
      if (r.hasFreshLease) {
        const current = store.getAgent(ident.canonical.id) || ident.canonical;
        return { ok: true, agent: browserAgentPresentation({ ...current, is_online: true }), lease_released: true };
      }
      // No fresh leases remain - but do NOT force offline if we can't prove
      // other tabs are gone; keep heartbeat-driven semantics. Only explicit
      // leave marks offline.
      const current = store.getAgent(ident.canonical.id) || ident.canonical;
      return { ok: true, agent: browserAgentPresentation(current), lease_released: true };
    }
    if (explicit) {
      if (typeof (store as any).clearAllBrowserLeases === "function") (store as any).clearAllBrowserLeases(ident.canonical.id);
      store.setAgentOnlineState(ident.canonical.id, false, "browser_leave");
      reply.header("Set-Cookie", clearIdentityCookie(isSecureRequest(request)));
    }
    const current = store.getAgent(ident.canonical.id) || ident.canonical;
    return { ok: true, agent: browserAgentPresentation(current) };
  });

  function joinedThread(request: FastifyRequest, reply: FastifyReply, agent: AgentRecord) {
    const id = openThread((request.params as { threadId: string }).threadId, reply);
    if (!id) return;
    if (!store.getThreadAgents(id).some(member => member.id === agent.id)) {
      reply.code(403).send({ error: "JOIN_REQUIRED", detail: "请先加入该讨论。" });
      return;
    }
    return id;
  }

  server.get(`${prefix}/threads/:threadId/task-receipts`, async (request, reply) => {
    const ident = auth(request, reply);
    if (!ident) return;
    const threadId = joinedThread(request, reply, ident.canonical);
    if (!threadId) return;
    const query = request.query as Record<string, string>;
    const afterSeq = Number(query.after_seq || 0);
    const limit = Number(query.limit || 200);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return reply.code(400).send({ error: "INVALID_PAGINATION" });
    const page = store.listTaskReceipts({ threadId, afterSeq, limit });
    return { ...page, receipts: page.receipts.filter(r => r.target_agent_id === ident.canonical.id) };
  });

  server.post(`${prefix}/threads/:threadId/messages/:messageId/task-receipt`, async (request, reply) => {
    if (rejectCrossOrigin(request, reply)) return;
    const ident = auth(request, reply);
    if (!ident) return;
    const threadId = joinedThread(request, reply, ident.canonical);
    if (!threadId) return;
    const body = (request.body || {}) as Body;
    if (body.expected_agent_id !== ident.canonical.id) return reply.code(409).send({ error: "BROWSER_IDENTITY_MISMATCH", detail: "浏览器身份已变化，请刷新后操作。" });
    if (typeof body.expected_version !== "number" || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0) return reply.code(400).send({ error: "INVALID_EXPECTED_VERSION" });
    const result = store.acknowledgeTaskReceipt({ threadId, messageId: (request.params as { messageId: string }).messageId, targetAgentId: ident.canonical.id, status: typeof body.status === "string" ? body.status : "", expectedVersion: body.expected_version });
    if (!result.ok) return reply.code(result.code).send({ error: result.error, detail: result.detail });
    return { receipt: result.receipt };
  });

  server.post(`${prefix}/threads/:threadId/sync-context`, async (request, reply) => {
    const ident = auth(request, reply);
    if (!ident) return;
    const threadId = joinedThread(request, reply, ident.canonical);
    if (threadId) return store.issueSyncContext(threadId, ident.canonical.id, "browser-agent");
  });

  server.post(`${prefix}/threads/:threadId/messages`, async (request, reply) => {
    const ident = auth(request, reply);
    if (!ident) return;
    const threadId = joinedThread(request, reply, ident.canonical);
    if (!threadId) return;
    const body = (request.body || {}) as Body;
    if (body.author !== undefined || body.agent_id !== undefined || body.role !== undefined) {
      return reply.code(400).send({ error: "IDENTITY_IS_SERVER_ASSIGNED" });
    }
    if (body.expected_agent_id !== undefined && typeof body.expected_agent_id !== "string") {
      return reply.code(400).send({ error: "INVALID_EXPECTED_AGENT_ID", detail: "expected_agent_id must be a string when provided." });
    }
    // Cookie-auth new frontend must assert expected identity; header-token legacy
    // clients may omit the field for compatibility.
    if (ident.source !== "header" && typeof body.expected_agent_id !== "string") {
      return reply.code(400).send({ error: "MISSING_EXPECTED_AGENT_ID", detail: "Cookie-authenticated browser messages must include expected_agent_id." });
    }
    if (typeof body.expected_agent_id === "string" && body.expected_agent_id !== ident.canonical.id) {
      return reply.code(409).send({ error: "BROWSER_IDENTITY_MISMATCH", detail: "浏览器身份已变化，请刷新身份后重试。", agent_id: ident.canonical.id });
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      return reply.code(400).send({ error: "EMPTY_MESSAGE" });
    }
    if (typeof body.expected_last_seq !== "number" || !Number.isSafeInteger(body.expected_last_seq) || body.expected_last_seq < 0 || typeof body.reply_token !== "string" || !body.reply_token) {
      return reply.code(400).send({ error: "MISSING_SYNC_FIELDS" });
    }
    try {
      const message = store.postMessage({
        threadId,
        author: ident.canonical.id,
        role: "assistant",
        content: body.content,
        expectedLastSeq: body.expected_last_seq,
        replyToken: body.reply_token,
        replyToMsgId: typeof body.reply_to_msg_id === "string" ? body.reply_to_msg_id : undefined,
        metadata: { connection_type: "browser", presence_semantics: "web_session" },
      });
      store.setAgentOnlineState(ident.canonical.id, true, "browser_message");
      return reply.code(201).send(message);
    } catch (error) {
      if (error instanceof SeqMismatchError) {
        return reply.code(409).send({ error: "SEQ_MISMATCH", current_seq: error.current_seq, expected_last_seq: error.expected_last_seq });
      }
      if (error instanceof BusError) return reply.code(400).send({ detail: error.detail });
      return reply.code(400).send({ error: "MESSAGE_REJECTED", detail: (error as Error).message });
    }
  });
}
