import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../src/core/services/memoryStore.js";
import { registerTaskReceiptRoutes } from "../../src/transports/http/taskReceipts.js";

function appWithStore(store: MemoryStore) {
  const app = Fastify({ logger: false });
  registerTaskReceiptRoutes(app, store);
  return app;
}

function agentHeaders(id: string, token: string) {
  return { "x-agent-id": id, "x-agent-token": token, "content-type": "application/json" };
}

describe("task receipts (directed message ack)", () => {
  let store: MemoryStore;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    process.env.AGENTCHATBUS_TEST_DB = ":memory:";
    store = new MemoryStore(":memory:");
    app = appWithStore(store);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    try { (store as any).close?.(); } catch {}
  });

  async function register(name: string) {
    const a = store.registerAgent({ ide: "TestIDE", model: name, display_name: name, capabilities: ["mcp"] });
    // registerAgent returns AgentRecord; token is stored - need to read back
    const full = store.getAgent(a.id)!;
    return { id: full.id, token: full.token as string, name: full.display_name || full.name };
  }

  function mkThread(topic = "receipt-thread") {
    return store.createThread(topic).thread;
  }

  function post(s: MemoryStore, threadId: string, author: string, content: string, metadata?: any) {
    try {
      return s.postMessage({ threadId, author, content, metadata });
    } catch (e: any) {
      const sync = (s as any).issueSyncContext?.(threadId, author) || (s as any).issueSyncContext?.(threadId);
      return s.postMessage({ threadId, author, content, metadata, expectedLastSeq: sync?.current_seq, replyToken: sync?.reply_token });
    }
  }

  it("no mentions => no receipts", async () => {
    const author = await register("Author");
    const thread = mkThread();
    post(store, thread.id, author.id, "hello", {});
    post(store, thread.id, author.id, "plain", { foo: 1 });
    const res = await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts` });
    expect(res.statusCode).toBe(200);
    expect(res.json().receipts).toEqual([]);
    expect(res.json().has_more).toBe(false);
  });

  it("duplicate targets deduped; only registered UUID targets generate receipts", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const browserTarget = store.registerAgent({ ide: "Web", model: "Browser", display_name: "Browser", capabilities: ["browser-ui"] });
    const browserFull = store.getAgent(browserTarget.id)!;
    const thread = mkThread();
    const fakeUuid = "00000000-0000-4000-8000-000000000099";
    post(store, thread.id, author.id, "task", { mentions: [target.id, target.id, browserFull.id, fakeUuid, "not-a-uuid", author.name] });
    const res = await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts` });
    expect(res.statusCode).toBe(200);
    const receipts = res.json().receipts;
    expect(receipts.map((r: any) => r.target_agent_id).sort()).toEqual([browserFull.id, target.id].sort());
    expect(receipts.every((r: any) => r.target_agent_id !== fakeUuid)).toBe(true);
    expect(receipts.every((r: any) => r.status === "awaiting_ack" && r.version === 0 && r.delivery_mode === "manual_pull" && r.can_auto_wake === false)).toBe(true);
    const browser = receipts.find((r: any) => r.target_agent_id === browserFull.id);
    const mcp = receipts.find((r: any) => r.target_agent_id === target.id);
    expect(browser.connection_type).toBe("browser");
    expect(mcp.connection_type).toBe("mcp");
    expect(JSON.stringify(res.json())).not.toContain(browserFull.token || "___no___");
  });

  it("wrong identity/credentials rejected; auth before sensitive confirmation beyond own auth", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const other = await register("Other");
    const thread = mkThread();
    const msg = post(store, thread.id, author.id, "do it", { mentions: [target.id] });

    const noAuth = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`, payload: { status: "acknowledged", expected_version: 0 } });
    expect(noAuth.statusCode).toBe(401);

    const badToken = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`, headers: agentHeaders(target.id, "wrong"), payload: { status: "acknowledged", expected_version: 0 } });
    expect(badToken.statusCode).toBe(401);

    const wrongAgent = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`, headers: agentHeaders(other.id, other.token), payload: { status: "acknowledged", expected_version: 0 } });
    expect(wrongAgent.statusCode).toBe(403);

    // target still awaiting
    const list = (await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts` })).json();
    expect(list.receipts[0].status).toBe("awaiting_ack");
    expect(list.receipts[0].version).toBe(0);
  });

  it("state machine, idempotent same state, version conflict", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const thread = mkThread();
    store.addThreadParticipant(thread.id, target.id);
    const msg = post(store, thread.id, author.id, "do it", { mentions: [target.id] });
    const url = `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`;
    const h = agentHeaders(target.id, target.token);

    const ack = await app.inject({ method: "POST", url, headers: h, payload: { status: "acknowledged", expected_version: 0, detail: "seen" } });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().receipt.status).toBe("acknowledged");
    expect(ack.json().receipt.version).toBe(1);
    expect(ack.json().receipt.detail).toBe("seen");

    const idem = await app.inject({ method: "POST", url, headers: h, payload: { status: "acknowledged", expected_version: 1 } });
    expect(idem.statusCode).toBe(200);
    expect(idem.json().receipt.version).toBe(1);

    const conflict = await app.inject({ method: "POST", url, headers: h, payload: { status: "running", expected_version: 0 } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("VERSION_CONFLICT");

    const run = await app.inject({ method: "POST", url, headers: h, payload: { status: "running", expected_version: 1 } });
    expect(run.statusCode).toBe(200);
    expect(run.json().receipt.version).toBe(2);

    const done = await app.inject({ method: "POST", url, headers: h, payload: { status: "completed", expected_version: 2 } });
    expect(done.statusCode).toBe(200);
    expect(done.json().receipt.status).toBe("completed");

    const rollback = await app.inject({ method: "POST", url, headers: h, payload: { status: "running", expected_version: 3 } });
    expect(rollback.statusCode).toBe(409);
    expect(rollback.json().error).toBe("INVALID_TRANSITION");
  });

  it("invalid jump and invalid status rejected", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const thread = mkThread();
    store.addThreadParticipant(thread.id, target.id);
    const msg = post(store, thread.id, author.id, "do it", { mentions: [target.id] });
    const url = `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`;
    const h = agentHeaders(target.id, target.token);
    const bad = await app.inject({ method: "POST", url, headers: h, payload: { status: "delivered", expected_version: 0 } });
    expect(bad.statusCode).toBe(400);
    const jump = await app.inject({ method: "POST", url, headers: h, payload: { status: "completed", expected_version: 0 } });
    expect(jump.statusCode).toBe(409);
    for (const version of [null, "0", false]) {
      expect((await app.inject({ method: "POST", url, headers: h, payload: { status: "acknowledged", expected_version: version } })).statusCode).toBe(400);
    }
  });

  it("browser online does not imply auto wake", async () => {
    const author = await register("Author");
    const browser = store.registerAgent({ ide: "Web", model: "B", display_name: "B", capabilities: ["browser-ui"] });
    // Even if marked online, receipts must never become auto-deliverable/wakeable.
    (store.getAgent(browser.id) as any).is_online = true;
    const thread = mkThread();
    post(store, thread.id, author.id, "x", { mentions: [browser.id] });
    const receipts = (await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts` })).json().receipts;
    expect(receipts[0].connection_type).toBe("browser");
    expect(receipts[0].can_auto_wake).toBe(false);
    expect(receipts[0].delivery_mode).toBe("manual_pull");
    expect(receipts[0].status).toBe("awaiting_ack");
  });

  it("persistence across store reopen retains confirmed state", async () => {
    const base = process.env.TEMP || process.env.TMP || tmpdir();
    const dir = mkdtempSync(join(base, "acb-receipts-"));
    const db = join(dir, "t.db");
    let s1: MemoryStore | undefined;
    let s2: MemoryStore | undefined;
    let app1: ReturnType<typeof appWithStore> | undefined;
    let app2: ReturnType<typeof appWithStore> | undefined;
    try {
      s1 = new MemoryStore(db);
      app1 = appWithStore(s1); await app1.ready();
      const author = s1.registerAgent({ ide: "T", model: "A", display_name: "A", capabilities: ["mcp"] });
      const target = s1.registerAgent({ ide: "T", model: "T", display_name: "T", capabilities: ["mcp"] });
      const thread = s1.createThread("p").thread;
      s1.addThreadParticipant(thread.id, target.id);
      const sync = (s1 as any).issueSyncContext(thread.id);
      const msg = s1.postMessage({ threadId: thread.id, author: author.id, content: "c", metadata: { mentions: [target.id] }, expectedLastSeq: sync.current_seq, replyToken: sync.reply_token });
      const t = s1.getAgent(target.id)!;
      const ack = await app1.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`, headers: agentHeaders(target.id, t.token as string), payload: { status: "acknowledged", expected_version: 0 } });
      expect(ack.statusCode).toBe(200);
      await app1.close(); (s1 as any).close?.();

      s2 = new MemoryStore(db);
      app2 = appWithStore(s2); await app2.ready();
      const list = (await app2.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts` })).json();
      expect(list.receipts[0].status).toBe("acknowledged");
      expect(list.receipts[0].version).toBe(1);
      await app2.close(); (s2 as any).close?.();
    } finally {
      try { await app2?.close(); } catch {}
      try { await app1?.close(); } catch {}
      try { (s2 as any)?.close?.(); } catch {}
      try { (s1 as any)?.close?.(); } catch {}
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  });

  it("closed thread readable but not ackable", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const thread = mkThread();
    const msg = post(store, thread.id, author.id, "c", { mentions: [target.id] });
    store.updateThreadStatus(thread.id, "closed");
    const list = await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts` });
    expect(list.statusCode).toBe(200);
    expect(list.json().receipts).toHaveLength(1);
    const ack = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`, headers: agentHeaders(target.id, target.token), payload: { status: "acknowledged", expected_version: 0 } });
    expect(ack.statusCode).toBe(409);
    expect(ack.json().error).toBe("THREAD_CLOSED");
  });

  it("pagination by message seq respects limit and has_more/next_seq", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const thread = mkThread();
    for (let i = 0; i < 3; i++) post(store, thread.id, author.id, `m${i}`, { mentions: [target.id] });
    const p1 = (await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts?after_seq=0&limit=2` })).json();
    expect(p1.receipts.length).toBe(2);
    expect(p1.has_more).toBe(true);
    expect(typeof p1.next_seq).toBe("number");
    const p2 = (await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts?after_seq=${p1.next_seq}&limit=2` })).json();
    expect(p2.receipts.length).toBe(1);
    expect(p2.has_more).toBe(false);
    // cap limit
    const capped = await app.inject({ method: "GET", url: `/api/threads/${thread.id}/task-receipts?limit=999` });
    expect(capped.statusCode).toBe(200);
  });

  it("POST only for real mention target of original message", async () => {
    const author = await register("Author");
    const target = await register("Target");
    const other = await register("Other");
    const thread = mkThread();
    const msg = post(store, thread.id, author.id, "c", { mentions: [target.id] });
    // other authenticates as self but is not the mentioned target for this receipt path? path has :agentId = other.id
    // but auth requires agentId == expectedAgentId (path) - so other can auth for /.../other.id; store must reject because other not in mentions
    const res = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${other.id}`, headers: agentHeaders(other.id, other.token), payload: { status: "acknowledged", expected_version: 0 } });
    expect([403, 404]).toContain(res.statusCode); // auth passes for self but target not valid receipt -> 404 RECEIPT_TARGET_NOT_FOUND
    expect(res.statusCode).toBe(404);
    const nonmember = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/messages/${msg.id}/task-receipts/${target.id}`, headers: agentHeaders(target.id, target.token), payload: { status: "acknowledged", expected_version: 0 } });
    expect(nonmember.statusCode).toBe(403);
  });

  it("invalid pagination fails clearly instead of producing a server error", async () => {
    const thread = mkThread();
    for (const query of ["limit=abc", "limit=1.5", "after_seq=-1", "after_seq=Infinity"]) {
      expect((await app.inject({ url: `/api/threads/${thread.id}/task-receipts?${query}` })).statusCode).toBe(400);
    }
  });
});
