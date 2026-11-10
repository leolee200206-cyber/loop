import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpServer, getMemoryStore } from "../../src/transports/http/server.js";
import { publicBrowserEvent } from "../../src/transports/http/browserAgents.js";

describe("independent browser agent identities", () => {
  let server: ReturnType<typeof createHttpServer>;
  let threadId: string;
  beforeEach(() => {
    process.env.AGENTCHATBUS_DB = ":memory:";
    process.env.AGENTCHATBUS_TEST_DB = ":memory:";
    process.env.AGENTCHATBUS_SHOW_AD = "0";
    server = createHttpServer();
    threadId = getMemoryStore().createThread("browser agent fixture").thread.id;
  });
  afterEach(async () => { await server.close(); });

  async function join(name = "Muse · Marley", extraPayload: Record<string, unknown> = {}) {
    const result = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { display_name: name, provider: "Muse", thread_id: threadId, ...extraPayload } });
    expect(result.statusCode).toBe(200);
    const identity = result.json();
    return { identity, headers: { "x-agent-id": identity.agent.id, "x-agent-token": identity.token }, result };
  }

  function cookieHeaderFrom(result: { headers: Record<string, unknown> }) {
    const raw = result.headers["set-cookie"];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return typeof first === "string" ? first : "";
  }
  function cookieFrom(result: { headers: Record<string, unknown> }) {
    return cookieHeaderFrom(result).split(";")[0] || "";
  }

  it("registers a real member, with token returned only on initial join", async () => {
    const { identity, headers } = await join();
    expect(identity.agent.connection_type).toBe("browser");
    expect(identity.agent.presence_semantics).toBe("web_session");
    expect(identity.agent.token).toBeUndefined();
    expect(identity.token).toBeTruthy();
    expect(getMemoryStore().getThreadAgents(threadId).some(a => a.id === identity.agent.id)).toBe(true);
    const resumed = await server.inject({ method: "POST", url: "/api/browser-agents/join", headers, payload: { thread_id: threadId } });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().agent.id).toBe(identity.agent.id);
    expect(resumed.json().token).toBeUndefined();
    expect(getMemoryStore().listAgents()).toHaveLength(1);
    const listed = (await server.inject({ url: "/api/agents" })).json();
    expect(JSON.stringify(listed)).not.toContain(identity.token);
    expect(listed[0].connection_type).toBe("browser");
    expect(listed[0].presence_semantics).toBe("web_session");
    const detail = (await server.inject({ url: `/api/agents/${identity.agent.id}` })).json();
    expect(detail.token).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain(identity.token);
    const participants = (await server.inject({ url: `/api/threads/${threadId}/agents` })).json();
    expect(JSON.stringify(participants)).not.toContain(identity.token);
  });

  it("assigns distinct identities even with the same display name only when explicitly confirmed as a different identity", async () => {
    const a = await join();
    const conflict = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { display_name: "Muse · Marley", provider: "Muse", thread_id: threadId } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("BROWSER_IDENTITY_EXISTS");
    // Recurrence guard: create_new alone is insufficient when same-name exists.
    const blocked = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { display_name: "Muse · Marley", provider: "Muse", thread_id: threadId, create_new: true } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("BROWSER_IDENTITY_CREATE_CONFIRMATION_REQUIRED");
    expect(getMemoryStore().listAgents({ includeRetiredBrowserAliases: true } as any).length).toBe(1);
    // Explicit different-identity confirmation is allowed (same name != same identity).
    const b = await join("Muse · Marley", { create_new: true, confirm_different_identity: true });
    expect(a.identity.agent.id).not.toBe(b.identity.agent.id);
    expect(getMemoryStore().listAgents({ includeRetiredBrowserAliases: true } as any).length).toBeGreaterThanOrEqual(2);
    const forged = await server.inject({ method: "POST", url: "/api/browser-agents/heartbeat", headers: { ...a.headers, "x-agent-id": b.identity.agent.id }, payload: {} });
    expect(forged.statusCode).toBe(401);
  });

  it("invalid resume never silently creates a replacement identity", async () => {
    const { headers } = await join();
    const result = await server.inject({ method: "POST", url: "/api/browser-agents/join", headers: { ...headers, "x-agent-token": "wrong" }, payload: { thread_id: threadId, display_name: "replacement" } });
    expect(result.statusCode).toBe(401);
    expect(getMemoryStore().listAgents()).toHaveLength(1);
  });

  it("requires authentication and a real browser identity on every protected route", async () => {
    const cli = getMemoryStore().registerAgent({ ide: "CLI", model: "test" });
    for (const path of ["session", "heartbeat", "leave", `threads/${threadId}/sync-context`, `threads/${threadId}/messages`]) {
      const result = await server.inject({ method: path === "session" ? "GET" : "POST", url: `/api/browser-agents/${path}`, headers: { "x-agent-id": cli.id, "x-agent-token": cli.token! }, ...(path === "session" ? {} : { payload: {} }) });
      expect(result.statusCode).toBe(401);
    }
  });

  it("posts as the authenticated agent and rejects replay and author spoofing", async () => {
    const { identity, headers } = await join();
    const sync = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers, payload: {} })).json();
    const payload = { content: "Fixture message", expected_last_seq: sync.current_seq, reply_token: sync.reply_token };
    const forged = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers, payload: { ...payload, author: "human", role: "system" } });
    expect(forged.statusCode).toBe(400);
    // Header-token legacy client compatible without expected_agent_id.
    const posted = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers, payload });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().author_id).toBe(identity.agent.id);
    expect(posted.json().author_name).toBe("Muse · Marley");
    expect(posted.json().role).toBe("assistant");
    expect(posted.json().metadata.connection_type).toBe("browser");
    expect((await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers, payload })).statusCode).toBe(400);
    expect(getMemoryStore().getMessages(threadId, 0)).toHaveLength(1);
    const legacy = await server.inject({ method: "POST", url: `/api/threads/${threadId}/messages`, payload: { author: identity.agent.id, content: "impersonated" } });
    expect(legacy.statusCode).toBe(401);
  });

  it("requires membership and explicit synchronization rather than issuing tokens while posting", async () => {
    const { headers } = await join();
    const otherId = getMemoryStore().createThread("other fixture").thread.id;
    const notJoined = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${otherId}/sync-context`, headers, payload: {} });
    expect(notJoined.statusCode).toBe(403);
    const noSync = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers, payload: { content: "missing token" } });
    expect(noSync.statusCode).toBe(400);
    expect(noSync.json().error).toBe("MISSING_SYNC_FIELDS");
  });

  it("leaves without deleting identity, then resumes with the same ID", async () => {
    const { identity, headers } = await join();
    const left = await server.inject({ method: "POST", url: "/api/browser-agents/leave", headers, payload: {} });
    expect(left.json().agent.is_online).toBe(false);
    expect(left.json().agent.token).toBeUndefined();
    const session = await server.inject({ url: "/api/browser-agents/session", headers });
    expect(session.json().agent.id).toBe(identity.agent.id);
    expect(session.json().agent.is_online).toBe(false);
    const heartbeat = await server.inject({ method: "POST", url: "/api/browser-agents/heartbeat", headers, payload: {} });
    expect(heartbeat.json().agent.is_online).toBe(true);
    expect(getMemoryStore().getAgent(identity.agent.id)?.last_activity).toBe("browser_heartbeat");
    expect(getMemoryStore().listAgents()).toHaveLength(1);
  });

  it("validates threads and names before creating an agent", async () => {
    getMemoryStore().closeThread(threadId, "fixture closed");
    const closed = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { thread_id: threadId, display_name: "Muse" } });
    expect(closed.statusCode).toBe(409);
    expect(getMemoryStore().listAgents()).toHaveLength(0);
    const missing = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { thread_id: "missing", display_name: "Muse" } });
    expect(missing.statusCode).toBe(404);
    const open = getMemoryStore().createThread("open fixture").thread.id;
    for (const display_name of ["", "x".repeat(61), "bad\nname"]) {
      const result = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { thread_id: open, display_name } });
      expect(result.statusCode).toBe(400);
    }
    expect(getMemoryStore().listAgents()).toHaveLength(0);
  });

  it("rejects cross-origin joins, preserves no-store, and accepts same-origin", async () => {
    const payload = { thread_id: threadId, display_name: "Muse" };
    const foreign = await server.inject({ method: "POST", url: "/api/browser-agents/join", headers: { origin: "https://evil.invalid" }, payload });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers["cache-control"]).toBe("no-store");
    const same = await server.inject({ method: "POST", url: "/api/browser-agents/join", headers: { host: "example.test", origin: "https://example.test" }, payload });
    expect(same.statusCode).toBe(200);
  });

  it("removes credentials from public lifecycle events without mutating the store record", () => {
    for (const type of ["agent.online", "agent.updated"]) {
      const original = { type, payload: { id: "agent", token: "secret-token", is_online: true } };
      expect(publicBrowserEvent(original)).toEqual({ type, payload: { id: "agent", is_online: true } });
      expect(original.payload.token).toBe("secret-token");
    }
    const message = { type: "msg.new", payload: { content: "token", metadata: null } };
    expect(publicBrowserEvent(message)).toBe(message);
  });

  // ---- Browser identity v2 (isolated fixtures; no prod DB) ----

  it("v2: cookie session recovers same identity without re-registering; refresh/re-enter/thread-switch path safe", async () => {
    const first = await join("Muse Cookie");
    const setCookie = cookieFrom(first.result);
    const setCookieHeader = cookieHeaderFrom(first.result);
    expect(setCookie).toContain("acb_browser_identity=");
    expect(setCookieHeader.toLowerCase()).toContain("httponly");
    expect(setCookieHeader.toLowerCase()).toContain("samesite=lax");
    expect(setCookieHeader).toContain("Path=/api/browser-agents");
    // Backward-compat: initial join may return token in response body for
    // header-token clients; agent presentation must never include token and
    // frontend v2 must not persist it in localStorage/URL/sessionStorage.
    expect(first.identity.agent.token).toBeUndefined();
    expect(typeof first.identity.token === "string" || first.identity.token === undefined).toBe(true);

    // New tab/reopen simulation: no headers, only cookie.
    const resumed = await server.inject({ method: "POST", url: "/api/browser-agents/join", headers: { cookie: setCookie }, payload: { thread_id: threadId } });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().agent.id).toBe(first.identity.agent.id);
    expect(resumed.json().token).toBeUndefined();
    expect(getMemoryStore().listAgents()).toHaveLength(1);

    const session = await server.inject({ url: "/api/browser-agents/session", headers: { cookie: setCookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().agent.id).toBe(first.identity.agent.id);

    const otherThread = getMemoryStore().createThread("other v2").thread.id;
    const switched = await server.inject({ method: "POST", url: "/api/browser-agents/join", headers: { cookie: setCookie }, payload: { thread_id: otherThread } });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().agent.id).toBe(first.identity.agent.id);
    expect(getMemoryStore().listAgents()).toHaveLength(1);
  });

  it("confirmed aliases survive a real database reopen without rewriting message history", async () => {
    const { MemoryStore } = await import("../../src/core/services/memoryStore.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "acb-alias-reopen-"));
    let first: InstanceType<typeof MemoryStore> | undefined;
    let reopened: InstanceType<typeof MemoryStore> | undefined;
    try {
      const dbPath = path.join(folder, "fixture.db");
      first = new MemoryStore(dbPath);
      const canonical = first.registerAgent({ ide: "Muse", model: "Browser", display_name: "Muse Fixture", capabilities: ["browser-ui"] });
      const old = first.registerAgent({ ide: "Muse", model: "Browser", display_name: "Muse Fixture", capabilities: ["browser-ui"] });
      const thread = first.createThread("alias reopen").thread;
      first.addThreadParticipant(thread.id, old.id);
      const sync = first.issueSyncContext(thread.id, old.id);
      const message = first.postMessage({ threadId: thread.id, author: old.id, content: "Preserve historical author", expectedLastSeq: sync.current_seq, replyToken: sync.reply_token });
      first.aliasBrowserIdentityAsDuplicate({ canonicalId: canonical.id, retiredId: old.id, reason: "explicit fixture relation" });
      (first as any).persistenceDb.close(); first = undefined;
      reopened = new MemoryStore(dbPath);
      expect(reopened.listAgents().map(a => a.id)).toEqual([canonical.id]);
      expect(reopened.getThreadAgents(thread.id).map(a => a.id)).toEqual([canonical.id]);
      expect(reopened.getMessage(message.id)).toMatchObject({ author_id: old.id, content: "Preserve historical author", seq: message.seq });
    } finally {
      if (first) (first as any).persistenceDb.close();
      if (reopened) (reopened as any).persistenceDb.close();
      const resolved = path.resolve(folder);
      expect(path.dirname(resolved)).toBe(path.resolve(os.tmpdir()));
      expect(path.basename(resolved)).toMatch(/^acb-alias-reopen-/);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  it("browser tasks can only be acknowledged by the intended cookie identity", async () => {
    const a = await join("Task owner");
    const b = await join("Other task agent");
    const posted = await server.inject({ method: "POST", url: `/api/threads/${threadId}/messages`, payload: { content: "Improve the icons", mentions: [a.identity.agent.id] } });
    expect(posted.statusCode).toBe(201);
    const messageId = posted.json().id;
    const root = `/api/browser-agents/threads/${threadId}`;
    const cookie = cookieFrom(a.result);
    const page = await server.inject({ url: `${root}/task-receipts`, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.json().receipts[0]).toMatchObject({ message_id: messageId, status: "awaiting_ack", can_auto_wake: false, version: 0 });
    const path = `${root}/messages/${messageId}/task-receipt`;
    const stale = await server.inject({ method: "POST", url: path, headers: { cookie }, payload: { expected_agent_id: b.identity.agent.id, expected_version: 0, status: "acknowledged" } });
    expect(stale.statusCode).toBe(409);
    const other = await server.inject({ method: "POST", url: path, headers: { cookie: cookieFrom(b.result) }, payload: { expected_agent_id: b.identity.agent.id, expected_version: 0, status: "acknowledged" } });
    expect(other.statusCode).toBe(404);
    const accepted = await server.inject({ method: "POST", url: path, headers: { cookie }, payload: { expected_agent_id: a.identity.agent.id, expected_version: 0, status: "acknowledged" } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().receipt).toMatchObject({ target_agent_id: a.identity.agent.id, status: "acknowledged", version: 1 });
    expect(getMemoryStore().getMessage(messageId)?.content).toBe("Improve the icons");
  });

  it("v2: cookie heartbeat and lease release do not overwrite a newer shared identity cookie", async () => {
    const a = await join("Cookie race");
    const cookie = cookieFrom(a.result);
    const hb = await server.inject({ method: "POST", url: "/api/browser-agents/heartbeat", headers: { cookie }, payload: { lease_id: "tab-a" } });
    expect(hb.statusCode).toBe(200);
    expect(hb.headers["set-cookie"]).toBeUndefined();
    const stale = await server.inject({ method: "POST", url: "/api/browser-agents/leave", headers: { cookie }, payload: { explicit_leave: true, expected_agent_id: "old-tab-identity" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers["set-cookie"]).toBeUndefined();
    const left = await server.inject({ method: "POST", url: "/api/browser-agents/leave", headers: { cookie }, payload: { lease_id: "tab-a" } });
    expect(left.statusCode).toBe(200);
    expect(left.headers["set-cookie"]).toBeUndefined();
    expect((await server.inject({ url: "/api/browser-agents/session", headers: { cookie } })).statusCode).toBe(200);
  });

  it("v2: legacy header token remains compatible and can establish migration cookie", async () => {
    const { identity, headers, result } = await join("Header Legacy");
    const hb = await server.inject({ method: "POST", url: "/api/browser-agents/heartbeat", headers, payload: {} });
    expect(hb.statusCode).toBe(200);
    expect(hb.json().agent.id).toBe(identity.agent.id);
    // Migration: explicit header + migration hint sets cookie.
    const mig = await server.inject({ method: "GET", url: "/api/browser-agents/session", headers: { ...headers, "x-browser-migrate-cookie": "1" } });
    expect(mig.statusCode).toBe(200);
    const setCookie = cookieFrom(mig);
    expect(setCookie).toContain("acb_browser_identity=");
    const byCookie = await server.inject({ url: "/api/browser-agents/session", headers: { cookie: setCookie } });
    expect(byCookie.statusCode).toBe(200);
    expect(byCookie.json().agent.id).toBe(identity.agent.id);
  });

  it("v2: no credentials cannot claim existing identity; same-name requires explicit choice", async () => {
    const existing = await join("Claimed Name");
    const noCreds = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { display_name: "Claimed Name", thread_id: threadId } });
    expect(noCreds.statusCode).toBe(409);
    expect(noCreds.json().error).toBe("BROWSER_IDENTITY_EXISTS");
    expect(getMemoryStore().listAgents().some(a => a.id === existing.identity.agent.id)).toBe(true);
    expect(getMemoryStore().listAgents()).toHaveLength(1);
    // Different display name, no creds -> creates new (distinct actor case is normal registration).
    const different = await server.inject({ method: "POST", url: "/api/browser-agents/join", payload: { display_name: "Different Actor", thread_id: threadId } });
    expect(different.statusCode).toBe(200);
    expect(different.json().agent.id).not.toBe(existing.identity.agent.id);
  });

  it("v2: multi-tab leases keep shared identity online; explicit leave offline; hidden-tab lease release alone does not force global offline", async () => {
    const a = await join("Lease Agent");
    const cookie = cookieFrom(a.result);
    const tabA = { cookie, "x-browser-lease-id": "lease-a" };
    const tabB = { cookie, "x-browser-lease-id": "lease-b" };
    expect((await server.inject({ method: "POST", url: "/api/browser-agents/heartbeat", headers: tabA, payload: { lease_id: "lease-a" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/api/browser-agents/heartbeat", headers: tabB, payload: { lease_id: "lease-b" } })).statusCode).toBe(200);
    // Tab A hidden/closed releases its lease; tab B still fresh => do not force global offline.
    const relA = await server.inject({ method: "POST", url: "/api/browser-agents/leave", headers: tabA, payload: { lease_id: "lease-a" } });
    expect(relA.statusCode).toBe(200);
    expect(relA.json().lease_released).toBe(true);
    expect(relA.json().agent.is_online).toBe(true);
    // Explicit leave (all tabs/user action) marks offline.
    const explicit = await server.inject({ method: "POST", url: "/api/browser-agents/leave", headers: tabB, payload: { explicit_leave: true } });
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().agent.is_online).toBe(false);
  });

  it("v2: admin-explicit alias retires duplicate into single canonical seat, preserves history and migrates old creds", async () => {
    const store = getMemoryStore();
    const oldAgent = await join("Muse · Marley", { create_new: true, confirm_different_identity: true });
    const canonical = await join("Muse · Marley", { create_new: true, confirm_different_identity: true });
    // post a message as old identity to preserve history
    const oldSync = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers: oldAgent.headers, payload: {} })).json();
    const posted = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: oldAgent.headers, payload: { content: "history from old id", expected_last_seq: oldSync.current_seq, reply_token: oldSync.reply_token } });
    expect(posted.statusCode).toBe(201);
    const oldMsgId = posted.json().id;
    const oldAuthorId = posted.json().author_id;
    expect(oldAuthorId).toBe(oldAgent.identity.agent.id);

    const aliased = (store as any).aliasBrowserIdentityAsDuplicate({
      canonicalId: canonical.identity.agent.id,
      retiredId: oldAgent.identity.agent.id,
      reason: "fixture duplicate Muse seat",
    });
    expect(aliased.canonical.id).toBe(canonical.identity.agent.id);
    expect(aliased.retired.browser_identity_canonical_id).toBe(canonical.identity.agent.id);

    // Ordinary list shows single seat (retired hidden).
    const listed = (await server.inject({ url: "/api/agents" })).json();
    const browserIds = listed.filter((a: any) => a.connection_type === "browser").map((a: any) => a.id);
    expect(browserIds).toContain(canonical.identity.agent.id);
    expect(browserIds).not.toContain(oldAgent.identity.agent.id);

    // History preserved: message id/seq/content/author_id unchanged.
    const msgs = store.getMessages(threadId, 0);
    const found = msgs.find(m => m.id === oldMsgId);
    expect(found).toBeTruthy();
    expect(found!.content).toBe("history from old id");
    expect(found!.author_id).toBe(oldAuthorId);
    expect(found!.seq).toBe(posted.json().seq);

    // Old valid creds migrate to canonical (no re-register).
    const migrated = await server.inject({ method: "GET", url: "/api/browser-agents/session", headers: oldAgent.headers });
    expect(migrated.statusCode).toBe(200);
    expect(migrated.json().agent.id).toBe(canonical.identity.agent.id);
    const setCookie = cookieFrom(migrated);
    expect(setCookie).toContain("acb_browser_identity=");
  });

  it("v2: alias is reversible (admin-explicit)", async () => {
    const store = getMemoryStore();
    const a = await join("Rev A", { create_new: true });
    const b = await join("Rev B", { create_new: true });
    (store as any).aliasBrowserIdentityAsDuplicate({ canonicalId: b.identity.agent.id, retiredId: a.identity.agent.id, reason: "test" });
    expect(store.listAgents().map(x => x.id)).not.toContain(a.identity.agent.id);
    (store as any).revokeBrowserIdentityAlias({ retiredId: a.identity.agent.id, reason: "rollback test" });
    expect(store.listAgents({ includeRetiredBrowserAliases: true } as any).map(x => x.id)).toContain(a.identity.agent.id);
  });

  it("v2: alias chains are prohibited (A->B then B->C rejected)", async () => {
    const store = getMemoryStore();
    const a = await join("Chain A", { create_new: true });
    const b = await join("Chain B", { create_new: true });
    const c = await join("Chain C", { create_new: true });
    (store as any).aliasBrowserIdentityAsDuplicate({ canonicalId: b.identity.agent.id, retiredId: a.identity.agent.id, reason: "a->b" });
    expect(() => (store as any).aliasBrowserIdentityAsDuplicate({ canonicalId: c.identity.agent.id, retiredId: b.identity.agent.id, reason: "b->c chain" })).toThrow(/chain|canonical/i);
    // A remains aliased to B; B is not aliased to C
    expect(store.getAgent(a.identity.agent.id)?.browser_identity_canonical_id).toBe(b.identity.agent.id);
    expect(store.getAgent(b.identity.agent.id)?.browser_identity_canonical_id).toBeUndefined();
  });

  it("v2: cookie send requires expected_agent_id string; mismatch/non-string/missing rejected with no new message", async () => {
    const store = getMemoryStore();
    const a = await join("Cookie Sender A");
    const b = await join("Cookie Sender B", { create_new: true });
    const cookieA = cookieFrom(a.result);
    const cookieB = cookieFrom(b.result);
    const syncA = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers: { cookie: cookieA }, payload: {} })).json();
    const base = { expected_last_seq: syncA.current_seq, reply_token: syncA.reply_token, content: "nope" };

    const missing = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: { cookie: cookieA }, payload: base });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("MISSING_EXPECTED_AGENT_ID");

    const wrongType = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: { cookie: cookieA }, payload: { ...base, expected_agent_id: 12345 } });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error).toBe("INVALID_EXPECTED_AGENT_ID");

    // Cookie is A (canonical A) but client asserts B -> reject, do not misattribute.
    const mismatch = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: { cookie: cookieA }, payload: { ...base, expected_agent_id: b.identity.agent.id } });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error).toBe("BROWSER_IDENTITY_MISMATCH");

    // Cross-tab identity switch: cookie changed to B, stale UI still asserts A.
    const syncB = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers: { cookie: cookieB }, payload: {} })).json();
    const switched = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: { cookie: cookieB }, payload: { expected_last_seq: syncB.current_seq, reply_token: syncB.reply_token, content: "nope", expected_agent_id: a.identity.agent.id } });
    expect(switched.statusCode).toBe(409);

    expect(store.getMessages(threadId, 0)).toHaveLength(0);

    // Correct cookie send succeeds.
    const syncA2 = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers: { cookie: cookieA }, payload: {} })).json();
    const ok = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: { cookie: cookieA }, payload: { expected_last_seq: syncA2.current_seq, reply_token: syncA2.reply_token, content: "cookie send ok", expected_agent_id: a.identity.agent.id } });
    expect(ok.statusCode).toBe(201);
    expect(store.getMessages(threadId, 0)).toHaveLength(1);
  });

  it("v2: header-token legacy client may omit expected_agent_id for compatibility; non-string still rejected", async () => {
    const { headers } = await join("Legacy Header");
    const sync = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers, payload: {} })).json();
    const badType = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers, payload: { expected_last_seq: sync.current_seq, reply_token: sync.reply_token, content: "x", expected_agent_id: { bad: true } } });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error).toBe("INVALID_EXPECTED_AGENT_ID");
  });

  it("confirmed migration: duplicate browser-join seat aliases to canonical Muse·Marley with history preserved and unrelated Muse untouched", async () => {
    const store = getMemoryStore();
    // Canonical in the older Muse/Web session shape (matches prod 42f39694).
    const canonical = store.registerAgent({
      ide: "Muse", model: "Web session", description: "legacy web-session", display_name: "Muse · Marley",
      capabilities: ["browser-ui", "web-session-presence"],
    });
    store.addThreadParticipant(threadId, canonical.id);
    // Unrelated unconfirmed Muse (5240c608 class) - must not be touched.
    const unrelated = store.registerAgent({
      ide: "Muse", model: "Web session", description: "unconfirmed", display_name: "Muse",
      capabilities: ["browser-ui", "web-session-presence"],
    });
    store.addThreadParticipant(threadId, unrelated.id);

    // Duplicate created via the same browser-join signature as 3b0e6f1d.
    const dup = await join("Muse · Marley", { create_new: true, confirm_different_identity: true });
    expect(dup.identity.agent.id).not.toBe(canonical.id);
    const dupRecord = store.getAgent(dup.identity.agent.id)!;
    expect(dupRecord.ide).toBe("Browser");
    expect(dupRecord.model).toBe("Browser Agent (Muse)");

    const dupSync = (await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/sync-context`, headers: dup.headers, payload: {} })).json();
    const posted = await server.inject({ method: "POST", url: `/api/browser-agents/threads/${threadId}/messages`, headers: dup.headers, payload: { content: "history from duplicate seat", expected_last_seq: dupSync.current_seq, reply_token: dupSync.reply_token } });
    expect(posted.statusCode).toBe(201);
    const beforeCount = store.getMessages(threadId, 0).length;
    const beforeSeq = store.getThread(threadId)!.next_seq;

    (store as any).aliasBrowserIdentityAsDuplicate({
      canonicalId: canonical.id, retiredId: dup.identity.agent.id,
      reason: "confirmed_duplicate_muse_marley_3b0e6f1d_to_42f39694", actor: "opencode-migration",
    });

    const seats = store.getThreadAgents(threadId);
    expect(seats.map(s => s.id)).toContain(canonical.id);
    expect(seats.map(s => s.id)).toContain(unrelated.id);
    expect(seats.map(s => s.id)).not.toContain(dup.identity.agent.id);
    expect(seats.filter(s => String(s.display_name || "").includes("Marley")).map(s => s.id)).toEqual([canonical.id]);

    expect(store.getMessages(threadId, 0).length).toBe(beforeCount);
    expect(store.getThread(threadId)!.next_seq).toBe(beforeSeq);
    const hist = store.getMessages(threadId, 0).find(m => m.id === posted.json().id);
    expect(hist!.author_id).toBe(dup.identity.agent.id);

    const migrated = await server.inject({ method: "GET", url: "/api/browser-agents/session", headers: dup.headers });
    expect(migrated.statusCode).toBe(200);
    expect(migrated.json().agent.id).toBe(canonical.id);
    expect(store.getAgent(unrelated.id)?.browser_identity_canonical_id).toBeUndefined();
  });
});
