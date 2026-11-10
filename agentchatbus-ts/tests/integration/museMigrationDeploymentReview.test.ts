import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { MemoryStore } from "../../src/core/services/memoryStore.js";

const require = createRequire(import.meta.url);
const migrationScript = path.resolve(__dirname, "../../../maintenance/migrate-muse-marley-3b0e6f1d-to-42f39694.cjs");
const mig = require(migrationScript);
const { RETIRED_ID, CANONICAL_ID, UNTOUCHED_ID, THREAD_ID } = mig.CONSTANTS;

function mkTmpDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir: string) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
function runScript(args: string[]) {
  const r = spawnSync(process.execPath, [migrationScript, ...args], { encoding: "utf8", cwd: path.resolve(__dirname, "../../../") });
  let json: any = null;
  const tryParse = (s: string) => { try { return JSON.parse((s || "").trim()); } catch { const m = (s || "").match(/\{[\s\S]*\}\s*$/); if (m) try { return JSON.parse(m[0]); } catch {} return null; } };
  json = tryParse(r.stdout) || tryParse(r.stderr);
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", json };
}
function openMigDb(dbPath: string) { return mig.openNodeDb(dbPath); }

function seedBase(dbPath: string, opts: { participants: string[]; withRetiredMessage?: boolean; withOtherMessage?: boolean; threadSettings?: { creator_admin_id?: string|null; auto_assigned_admin_id?: string|null }; omitThreadSettingsRow?: boolean }) {
  const store = new MemoryStore(dbPath);
  const db: any = (store as any).persistenceDb;
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO agents (id,name,display_name,alias_source,ide,model,description,is_online,last_heartbeat,last_activity,last_activity_time,capabilities,skills,token,emoji,browser_identity_canonical_id,browser_identity_retired_at,browser_identity_retired_reason) VALUES (?,?,?,?,?,?,?,0,?,?,?, ?,?,?, ?,?,?,?)`);
  ins.run(CANONICAL_ID,'Muse (Web session) 4','Muse · Marley','auto','Muse','Web session','c',now,now,now,JSON.stringify(['browser-ui','web-session-presence']),null,'tok-canonical',null,null,null,null);
  ins.run(RETIRED_ID,'Browser (Browser Agent (Muse))','Muse · Marley','auto','Browser','Browser Agent (Muse)','Independent browser-agent identity',now,now,now,JSON.stringify(['browser-ui','chat']),null,'tok-retired-old-cred',null,null,null,null);
  ins.run(UNTOUCHED_ID,'Muse (Web session) 3','Muse','auto','Muse','Web session','u',now,now,now,JSON.stringify(['browser-ui','web-session-presence']),null,'tok-untouched',null,null,null,null);
  const ts = opts.threadSettings || {};
  if (!opts.omitThreadSettingsRow) {
    db.prepare(`INSERT OR REPLACE INTO thread_settings (thread_id,auto_administrator_enabled,timeout_seconds,switch_timeout_seconds,last_activity_time,auto_assigned_admin_id,auto_assigned_admin_name,admin_assignment_time,creator_admin_id,creator_admin_name,creator_assignment_time,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(THREAD_ID,1,60,60,now, ts.auto_assigned_admin_id || null, null, null, ts.creator_admin_id || null, null, null, now, now);
  }
  let nextSeq = 1;
  const msgs: any[] = [];
  if (opts.withRetiredMessage) {
    db.prepare(`INSERT OR REPLACE INTO messages (id,thread_id,seq,priority,author,author_id,author_name,author_emoji,role,content,metadata,reply_to_msg_id,created_at,edited_at,edit_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('m-retired', THREAD_ID, nextSeq, 'normal', RETIRED_ID, RETIRED_ID, 'Muse · Marley', null, 'assistant', 'history from retired', '{}', null, now, null, 0);
    msgs.push({id:'m-retired',thread_id:THREAD_ID,seq:nextSeq,author:RETIRED_ID,author_id:RETIRED_ID,role:'assistant',content:'history from retired',created_at:now,priority:'normal'});
    nextSeq++;
  }
  if (opts.withOtherMessage) {
    db.prepare(`INSERT OR REPLACE INTO messages (id,thread_id,seq,priority,author,author_id,author_name,author_emoji,role,content,metadata,reply_to_msg_id,created_at,edited_at,edit_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('m-other', 'other-thread', 1, 'normal', 'someone-else', 'someone-else', 'Other', null, 'assistant', 'global msg', '{}', null, now, null, 0);
  }
  const payload: any = {
    sequence: 1,
    threads: [{id:THREAD_ID,title:'fixture thread',status:'open',next_seq:nextSeq,created_at:now,updated_at:now}],
    threadMessages: [[THREAD_ID, msgs]],
    humanOnlyMessages: [],
    threadParticipants: [[THREAD_ID, opts.participants]],
    threadWaitStates: [],
    agents: [],
    syncTokens: [],
    logEntries: [],
    ideSessions: [],
    ideOwnerInstanceId: null,
    logCursor: 0,
    threadSettings: [[THREAD_ID,{auto_administrator_enabled:true,timeout_seconds:60,switch_timeout_seconds:60,last_activity_time:now,auto_assigned_admin_id:ts.auto_assigned_admin_id||undefined,creator_admin_id:ts.creator_admin_id||undefined}]],
    messageEditHistory: []
  };
  if (opts.withOtherMessage) {
    payload.threads.push({id:'other-thread',title:'other',status:'open',next_seq:2,created_at:now,updated_at:now});
    payload.threadMessages.push(['other-thread',[{id:'m-other',thread_id:'other-thread',seq:1,author:'someone-else',author_id:'someone-else',role:'assistant',content:'global msg',created_at:now,priority:'normal'}]]);
    payload.threadParticipants.push(['other-thread',['someone-else']]);
  }
  db.prepare(`INSERT OR REPLACE INTO state_snapshots (id,payload,updated_at) VALUES (1,?,?)`).run(JSON.stringify(payload), now);
  (store as any).persistenceDb.close();
}

function assertGlobalUnchanged(db: any) {
  const unt = db.prepare("SELECT * FROM agents WHERE id=?").get(UNTOUCHED_ID) as any;
  expect(unt).toBeTruthy();
  expect(unt.browser_identity_canonical_id).toBeNull();
  expect(unt.token).toBe('tok-untouched');
  // display_name must not be mutated by migration; MemoryStore may normalize on reopen (separate concern)
  expect(String(unt.display_name || '')).toContain('Muse');
  const can = db.prepare("SELECT * FROM agents WHERE id=?").get(CANONICAL_ID) as any;
  expect(can.browser_identity_canonical_id).toBeNull();
  expect(can.token).toBe('tok-canonical');
  expect(String(can.display_name || '')).toContain('Muse');
}

describe("Muse migration - deployment review (real MemoryStore schema)", () => {
  it("snapshot-only participant (zero messages): precheck/dry-run/apply/reopen preserve seat and old credential row", async () => {
    const dir = mkTmpDir("acb-mig-snaponly-");
    const dbPath = path.join(dir, "bus.db");
    let store: InstanceType<typeof MemoryStore> | undefined;
    try {
      seedBase(dbPath, { participants: [CANONICAL_ID, RETIRED_ID, UNTOUCHED_ID], withOtherMessage: true });
      const d = openMigDb(dbPath);
      try {
        const proj = mig.projectedThreadSeatIds(d, THREAD_ID);
        expect(proj.seats).toContain(RETIRED_ID);
        expect(proj.seats).toContain(CANONICAL_ID);
        expect(proj.seats).toContain(UNTOUCHED_ID);
        expect(proj.sources.snapshot.participantIds).toContain(RETIRED_ID);
      } finally { d.close(); }

      const dry = runScript(["--db", dbPath, "--dry-run"]);
      expect(dry.status).toBe(0);
      expect(dry.json?.ok).toBe(true);
      expect(dry.json?.precheck?.thread_seats_before).toContain(RETIRED_ID);

      const ap = runScript(["--db", dbPath, "--apply"]);
      expect(ap.status).toBe(0);
      expect(ap.json?.ok).toBe(true);

      store = new MemoryStore(dbPath);
      const seats = store.getThreadAgents(THREAD_ID).map(a => a.id);
      expect(seats).toContain(CANONICAL_ID);
      expect(seats).not.toContain(RETIRED_ID);
      expect(seats).toContain(UNTOUCHED_ID);
      const d2 = openMigDb(dbPath);
      try {
        const ret = d2.prepare("SELECT browser_identity_canonical_id, token, is_online FROM agents WHERE id=?").get(RETIRED_ID) as any;
        expect(ret.browser_identity_canonical_id).toBe(CANONICAL_ID);
        expect(ret.token).toBe('tok-retired-old-cred'); // old credential recovery material preserved
        assertGlobalUnchanged(d2);
        const other = d2.prepare("SELECT COUNT(*) c FROM messages WHERE id='m-other'").get() as any;
        expect(other.c).toBe(1);
      } finally { d2.close(); }
    } finally {
      if (store) try { (store as any).persistenceDb.close(); } catch {}
      cleanup(dir);
    }
  });

  it("message-only participant (author in messages, not in snapshot participants) is included in projection", async () => {
    const dir = mkTmpDir("acb-mig-msgonly-");
    const dbPath = path.join(dir, "bus.db");
    try {
      seedBase(dbPath, { participants: [CANONICAL_ID, UNTOUCHED_ID], withRetiredMessage: true, withOtherMessage: true });
      const d = openMigDb(dbPath);
      try {
        const proj = mig.projectedThreadSeatIds(d, THREAD_ID);
        expect(proj.seats).toContain(RETIRED_ID); // via messages.author_id
        expect(proj.sources.snapshot.participantIds).not.toContain(RETIRED_ID);
      } finally { d.close(); }
      const ap = runScript(["--db", dbPath, "--apply"]);
      expect(ap.status).toBe(0);
      expect(ap.json?.ok).toBe(true);
      expect(ap.json?.postcheck?.thread_message_summary?.count).toBe(1);
      const store = new MemoryStore(dbPath);
      try {
        const seats = store.getThreadAgents(THREAD_ID).map(a => a.id);
        expect(seats).toContain(CANONICAL_ID);
        expect(seats).not.toContain(RETIRED_ID);
        expect(seats).toContain(UNTOUCHED_ID);
        const msg = store.getMessages(THREAD_ID, 0).find(m => m.id === 'm-retired');
        expect(msg?.author_id).toBe(RETIRED_ID);
        expect(msg?.content).toBe('history from retired');
      } finally { (store as any).persistenceDb.close(); }
      const d2 = openMigDb(dbPath);
      try { assertGlobalUnchanged(d2); } finally { d2.close(); }
    } finally { cleanup(dir); }
  });

  it("admin-only participant (creator/auto admin in thread_settings, no snapshot/messages) is included in projection", async () => {
    const dir = mkTmpDir("acb-mig-adminonly-");
    const dbPath = path.join(dir, "bus.db");
    try {
      // retired as creator admin only
      seedBase(dbPath, { participants: [CANONICAL_ID, UNTOUCHED_ID], threadSettings: { creator_admin_id: RETIRED_ID } });
      const d = openMigDb(dbPath);
      try {
        const proj = mig.projectedThreadSeatIds(d, THREAD_ID);
        expect(proj.seats).toContain(RETIRED_ID);
      } finally { d.close(); }
      const ap = runScript(["--db", dbPath, "--apply"]);
      expect(ap.status).toBe(0);
      const store = new MemoryStore(dbPath);
      try {
        const seats = store.getThreadAgents(THREAD_ID).map(a => a.id);
        expect(seats).toContain(CANONICAL_ID);
        expect(seats).not.toContain(RETIRED_ID);
      } finally { (store as any).persistenceDb.close(); }

      // also test auto_assigned_admin_id
      const dir2 = mkTmpDir("acb-mig-autoadmin-");
      const dbPath2 = path.join(dir2, "bus.db");
      try {
        seedBase(dbPath2, { participants: [CANONICAL_ID, UNTOUCHED_ID], threadSettings: { auto_assigned_admin_id: RETIRED_ID } });
        const ap2 = runScript(["--db", dbPath2, "--apply"]);
        expect(ap2.status).toBe(0);
        const d2 = openMigDb(dbPath2);
        try {
          const proj2 = mig.projectedThreadSeatIds(d2, THREAD_ID);
          // after apply, retired projects to canonical
          expect(proj2.seats).toContain(CANONICAL_ID);
          expect(proj2.seats).not.toContain(RETIRED_ID);
        } finally { d2.close(); }
      } finally { cleanup(dir2); }
    } finally { cleanup(dir); }
  });

  it("corrupt snapshot is rejected clearly (no silent drop, no apply)", async () => {
    const dir = mkTmpDir("acb-mig-corrupt-");
    const dbPath = path.join(dir, "bus.db");
    try {
      seedBase(dbPath, { participants: [CANONICAL_ID, RETIRED_ID, UNTOUCHED_ID] });
      const d = openMigDb(dbPath);
      try {
        d.prepare("UPDATE state_snapshots SET payload=? WHERE id=1").run("{bad-json");
      } finally { d.close(); }
      const dry = runScript(["--db", dbPath, "--dry-run"]);
      expect(dry.status).toBe(2);
      expect(String(dry.json?.error || dry.stdout)).toMatch(/SNAPSHOT_CORRUPT|not valid JSON/);
      // DB unchanged
      const d2 = openMigDb(dbPath);
      try {
        const ret = d2.prepare("SELECT browser_identity_canonical_id FROM agents WHERE id=?").get(RETIRED_ID) as any;
        expect(ret.browser_identity_canonical_id).toBeNull();
      } finally { d2.close(); }
    } finally { cleanup(dir); }
  });

  it("unknown/unsupported schema is rejected clearly", async () => {
    const dir = mkTmpDir("acb-mig-badschema-");
    const dbPath = path.join(dir, "bus.db");
    try {
      // create DB missing required columns/tables (no thread_settings)
      const { DatabaseSync } = require("node:sqlite");
      const raw = new DatabaseSync(dbPath);
      raw.exec("CREATE TABLE agents (id TEXT PRIMARY KEY,name TEXT,display_name TEXT,capabilities TEXT,token TEXT,browser_identity_canonical_id TEXT,is_online INTEGER)");
      raw.exec("CREATE TABLE messages (id TEXT PRIMARY KEY,thread_id TEXT,seq INTEGER,author_id TEXT,author TEXT,author_name TEXT,author_emoji TEXT,role TEXT,content TEXT,metadata TEXT,reply_to_msg_id TEXT)");
      raw.exec("CREATE TABLE state_snapshots (id INTEGER PRIMARY KEY,payload TEXT)");
      raw.exec("CREATE TABLE thread_settings (thread_id TEXT PRIMARY KEY)"); // missing admin columns
      raw.close();
      const dry = runScript(["--db", dbPath, "--dry-run"]);
      expect(dry.status).toBe(2);
      expect(String(dry.json?.error || dry.stdout)).toMatch(/UNSUPPORTED_SCHEMA|column missing/);
    } finally { cleanup(dir); }
  });

  it("transaction rollback on injected postcheck failure (real runApply) restores all state", async () => {
    const dir = mkTmpDir("acb-mig-rollback-");
    const dbPath = path.join(dir, "bus.db");
    try {
      seedBase(dbPath, { participants: [CANONICAL_ID, RETIRED_ID, UNTOUCHED_ID], withRetiredMessage: true, withOtherMessage: true });
      const d = openMigDb(dbPath);
      try {
        const before = mig.captureState(d);
        const beforeRet = JSON.stringify(mig.stableRowSnapshot(before.retired));
        const beforeUnt = JSON.stringify(before.untouchedSnap);
        const beforeCan = JSON.stringify(before.canonicalSnap);
        const beforeMsgs = before.allMessages.sha256;
        let threw = false;
        try { mig.runApply(d, before, { __inject_failure: "boom" }); } catch (e) { threw = true; }
        expect(threw).toBe(true);
        const after = mig.captureState(d);
        expect(JSON.stringify(mig.stableRowSnapshot(after.retired))).toBe(beforeRet);
        expect(JSON.stringify(after.untouchedSnap)).toBe(beforeUnt);
        expect(JSON.stringify(after.canonicalSnap)).toBe(beforeCan);
        expect(after.allMessages.sha256).toBe(beforeMsgs);
      } finally { d.close(); }
    } finally { cleanup(dir); }
  });

  it("native full MemoryStore schema: apply preserves global history summary and 5240c608/canonical/main records", async () => {
    const dir = mkTmpDir("acb-mig-native-");
    const dbPath = path.join(dir, "bus.db");
    let store: InstanceType<typeof MemoryStore> | undefined;
    try {
      seedBase(dbPath, { participants: [CANONICAL_ID, RETIRED_ID, UNTOUCHED_ID], withRetiredMessage: true, withOtherMessage: true });
      // capture global summary before
      const d0 = openMigDb(dbPath);
      let beforeAll: any, beforeThread: any;
      try { beforeAll = mig.messageDigest(d0); beforeThread = mig.messageDigest(d0, "WHERE thread_id = ?", [THREAD_ID]); } finally { d0.close(); }

      const ap = runScript(["--db", dbPath, "--apply"]);
      expect(ap.status).toBe(0);
      expect(ap.json?.ok).toBe(true);
      expect(ap.json?.postcheck?.global_message_summary?.sha256).toBe(beforeAll.sha256);
      expect(ap.json?.postcheck?.thread_message_summary?.sha256).toBe(beforeThread.sha256);
      expect(ap.json?.postcheck?.untouched_5240c608_full_row_unchanged).toBe(true);
      expect(ap.json?.postcheck?.canonical_unchanged).toBe(true);

      store = new MemoryStore(dbPath);
      const seats = store.getThreadAgents(THREAD_ID).map(a => a.id);
      expect(seats.filter(id => id === CANONICAL_ID).length).toBe(1);
      expect(seats).not.toContain(RETIRED_ID);
      expect(seats).toContain(UNTOUCHED_ID);
      (store as any).persistenceDb.close(); store = undefined;

      const d2 = openMigDb(dbPath);
      try {
        assertGlobalUnchanged(d2);
        const ret = d2.prepare("SELECT token, browser_identity_canonical_id FROM agents WHERE id=?").get(RETIRED_ID) as any;
        expect(ret.token).toBe('tok-retired-old-cred');
        expect(ret.browser_identity_canonical_id).toBe(CANONICAL_ID);
      } finally { d2.close(); }
    } finally {
      if (store) try { (store as any).persistenceDb.close(); } catch {}
      cleanup(dir);
    }
  });
});
