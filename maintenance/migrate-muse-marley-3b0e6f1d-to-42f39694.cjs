#!/usr/bin/env node
/**
 * Explicit, user-confirmed browser identity migration (deployment-review fixed).
 *   retired:   3b0e6f1d-31ff-4297-b422-fcf0a14f23c3 (duplicate Muse·Marley seat)
 *   canonical: 42f39694-4517-4583-8b6b-96267c907158 (confirmed Muse·Marley)
 *
 * User confirmation (2026-11-09): only one Muse/Marley; added seat is same agent.
 * Scope: ONLY these two IDs. 5240c608-69be-4de9-b8fa-9dfc878aff6b (unconfirmed Muse)
 * is explicitly out of scope and must remain untouched. No nickname merge.
 *
 * Safety: dry-run by default. --apply required to mutate DB. Run during a
 * controlled maintenance window with service stopped and DB backup taken.
 * Does NOT rewrite message history rows (author_id/content/seq preserved).
 * Does NOT rewrite state_snapshots payload wholesale.
 *
 * Seat precheck/projection matches real MemoryStore.getThreadAgents sources:
 *   - state_snapshots(id=1).payload.threadParticipants (snapshot, validated)
 *   - messages.author_id (relational)
 *   - thread_settings.creator_admin_id / auto_assigned_admin_id (relational)
 * No thread_participants table is assumed or created.
 */
const fs = require("fs");
const path = require("path");

const RETIRED_ID = "3b0e6f1d-31ff-4297-b422-fcf0a14f23c3";
const CANONICAL_ID = "42f39694-4517-4583-8b6b-96267c907158";
const UNTOUCHED_ID = "5240c608-69be-4de9-b8fa-9dfc878aff6b";
const THREAD_ID = "09f51b9d-f32a-49e8-8e65-d8aae9f919d0";
const REASON = "user_confirmed_same_agent_merge_2026-11-09";

function fail(report, msg) {
  report.ok = false;
  report.error = msg;
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
}

function loadSqlite(dbPath) {
  try { return require("better-sqlite3"); }
  catch (e) {
    if (e && e.code && e.code !== "MODULE_NOT_FOUND") throw e;
    try {
      const { DatabaseSync } = require("node:sqlite");
      return { __nodeSqlite: true, open: (p) => wrapNodeSqlite(DatabaseSync, p) };
    } catch (e2) {
      if (e2 && e2.code && e2.code !== "MODULE_NOT_FOUND") throw e2;
      throw new Error(`No SQLite driver available (better-sqlite3 missing; node:sqlite unavailable). db=${dbPath}`);
    }
  }
}

function wrapNodeSqlite(DatabaseSync, dbPath) {
  const db = new DatabaseSync(dbPath);
  const wrapStmt = (stmt) => ({
    get: (...args) => stmt.get(...args),
    all: (...args) => stmt.all(...args),
    run: (...args) => stmt.run(...args),
  });
  return {
    prepare: (sql) => wrapStmt(db.prepare(sql)),
    exec: (sql) => db.exec(sql),
    // Must forward args: runApply calls tx(options.__inject_failure) for isolated rollback testing.
    transaction: (fn) => (...args) => {
      db.exec("BEGIN");
      try { const r = fn(...args); db.exec("COMMIT"); return r; }
      catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    },
    close: () => db.close(),
  };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function has(name) { return process.argv.includes(name); }

function row(db, sql, params) { return db.prepare(sql).get(...(params || [])); }
function rows(db, sql, params) { return db.prepare(sql).all(...(params || [])); }

function sha256(text) {
  return require("crypto").createHash("sha256").update(String(text)).digest("hex");
}

function stableRowSnapshot(r) {
  if (!r) return null;
  const keys = Object.keys(r).sort();
  const out = {};
  for (const k of keys) out[k] = r[k];
  return out;
}

function tableExists(db, name) {
  const r = row(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]);
  return !!(r && r.name);
}

function tableColumns(db, name) {
  return rows(db, `PRAGMA table_info(${name})`).map(r => String(r.name));
}

function assertRealSchema(db) {
  const required = ["agents", "messages", "thread_settings", "state_snapshots"];
  for (const t of required) {
    if (!tableExists(db, t)) throw new Error(`UNSUPPORTED_SCHEMA: required table missing: ${t}`);
  }
  const agentCols = new Set(tableColumns(db, "agents"));
  for (const c of ["id", "browser_identity_canonical_id", "capabilities", "token", "display_name", "is_online"]) {
    if (!agentCols.has(c)) throw new Error(`UNSUPPORTED_SCHEMA: agents.${c} column missing`);
  }
  const msgCols = new Set(tableColumns(db, "messages"));
  for (const c of ["id", "thread_id", "seq", "author_id"]) {
    if (!msgCols.has(c)) throw new Error(`UNSUPPORTED_SCHEMA: messages.${c} column missing`);
  }
  const tsCols = new Set(tableColumns(db, "thread_settings"));
  for (const c of ["thread_id", "creator_admin_id", "auto_assigned_admin_id"]) {
    if (!tsCols.has(c)) throw new Error(`UNSUPPORTED_SCHEMA: thread_settings.${c} column missing`);
  }
  const snapCols = new Set(tableColumns(db, "state_snapshots"));
  for (const c of ["id", "payload"]) {
    if (!snapCols.has(c)) throw new Error(`UNSUPPORTED_SCHEMA: state_snapshots.${c} column missing`);
  }
}

function readSnapshotThreadParticipants(db, threadId) {
  // MemoryStore.loadState reads state_snapshots id=1 payload.threadParticipants.
  // Must validate structure; missing/corrupt/malformed => fail clearly (cannot silently
  // drop snapshot-only participants such as a Muse who joined but never posted).
  const snap = row(db, "SELECT payload FROM state_snapshots WHERE id = 1");
  if (!snap || snap.payload == null || snap.payload === "") {
    throw new Error("SNAPSHOT_UNAVAILABLE: state_snapshots id=1 missing or empty payload; cannot safely determine snapshot participants");
  }
  let state;
  try { state = JSON.parse(String(snap.payload)); }
  catch (e) { throw new Error("SNAPSHOT_CORRUPT: state_snapshots payload is not valid JSON"); }
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("SNAPSHOT_INVALID: state_snapshots payload must be a JSON object");
  }
  const tp = state.threadParticipants;
  if (tp == null) {
    // Treat absent threadParticipants key as empty set only if the snapshot structure is otherwise valid.
    // (Older/edge snapshots may omit it; absence of the key itself is not corruption.)
    return { participantIds: [], snapshotOk: true, threadParticipantsKeyPresent: false };
  }
  if (!Array.isArray(tp)) {
    throw new Error("SNAPSHOT_INVALID: threadParticipants must be an array of [threadId, participantIds[]]");
  }
  const participantIds = [];
  let foundThread = false;
  for (let i = 0; i < tp.length; i++) {
    const entry = tp[i];
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error(`SNAPSHOT_INVALID: threadParticipants[${i}] must be [string threadId, string[] participantIds]`);
    }
    const tid = entry[0];
    const ids = entry[1];
    if (!Array.isArray(ids)) {
      throw new Error(`SNAPSHOT_INVALID: threadParticipants[${i}] participantIds must be an array`);
    }
    if (tid !== threadId) continue;
    foundThread = true;
    for (let j = 0; j < ids.length; j++) {
      if (typeof ids[j] !== "string") {
        throw new Error(`SNAPSHOT_INVALID: threadParticipants[${i}] contains non-string participant id`);
      }
      if (ids[j]) participantIds.push(ids[j]);
    }
  }
  return { participantIds, snapshotOk: true, threadParticipantsKeyPresent: true, threadFound: foundThread };
}

function messageDigest(db, whereSql = "", params = []) {
  // Proves author/content/seq/thread/id unchanged (not just count/max seq).
  const sql = `SELECT id, thread_id, seq, author_id, author, author_name, author_emoji, role, content, metadata, reply_to_msg_id FROM messages ${whereSql} ORDER BY thread_id, seq, id`;
  const list = rows(db, sql, params);
  return { count: list.length, sha256: sha256(JSON.stringify(list)) };
}

function projectedThreadSeatIds(db, threadId) {
  // Mirrors MemoryStore.getThreadAgents sources and canonical projection:
  // 1) snapshot threadParticipants, 2) messages.author_id, 3) thread_settings admin IDs.
  assertRealSchema(db);
  const participantIds = new Set();

  const snap = readSnapshotThreadParticipants(db, threadId);
  for (const id of snap.participantIds) participantIds.add(id);

  for (const r of rows(db, "SELECT DISTINCT author_id FROM messages WHERE thread_id = ? AND author_id IS NOT NULL AND author_id != ''", [threadId])) {
    if (r.author_id) participantIds.add(String(r.author_id));
  }

  const settings = row(db, "SELECT creator_admin_id, auto_assigned_admin_id FROM thread_settings WHERE thread_id = ?", [threadId]);
  if (settings) {
    if (settings.creator_admin_id) participantIds.add(String(settings.creator_admin_id));
    if (settings.auto_assigned_admin_id) participantIds.add(String(settings.auto_assigned_admin_id));
  }

  const byCanonical = new Set();
  for (const id of participantIds) {
    const a = row(db, "SELECT id, browser_identity_canonical_id FROM agents WHERE id = ?", [id]);
    if (!a) { byCanonical.add(id); continue; }
    byCanonical.add(a.browser_identity_canonical_id || a.id);
  }
  return { seats: Array.from(byCanonical), sources: { snapshot: snap, participantCount: participantIds.size } };
}

function txFail(msg) { const e = new Error(msg); e.migrationPostcheck = true; throw e; }

function captureState(db) {
  const canonical = row(db, "SELECT * FROM agents WHERE id = ?", [CANONICAL_ID]);
  const retired = row(db, "SELECT * FROM agents WHERE id = ?", [RETIRED_ID]);
  const untouched = row(db, "SELECT * FROM agents WHERE id = ?", [UNTOUCHED_ID]);
  const proj = projectedThreadSeatIds(db, THREAD_ID);
  return {
    canonical, retired, untouched,
    canonicalSnap: stableRowSnapshot(canonical),
    retiredSnap: stableRowSnapshot(retired),
    untouchedSnap: stableRowSnapshot(untouched),
    threadSeats: proj.seats,
    threadSeatSources: proj.sources,
    threadMessages: messageDigest(db, "WHERE thread_id = ?", [THREAD_ID]),
    allMessages: messageDigest(db),
    agentsCount: row(db, "SELECT COUNT(*) AS c FROM agents")?.c ?? null,
  };
}

function runApply(db, before, options = {}) {
  // options.__inject_failure: isolated-test hook; when set, throws inside the
  // same transaction AFTER UPDATE and BEFORE COMMIT so rollback can be proven on
  // the actual runApply path (never use in production).
  const now = new Date().toISOString();
  const tx = db.transaction((injectFailure) => {
    db.prepare(`UPDATE agents SET browser_identity_canonical_id=?, browser_identity_retired_at=COALESCE(browser_identity_retired_at,?), browser_identity_retired_reason=?, is_online=0, last_activity=?, last_activity_time=? WHERE id=?`)
      .run(CANONICAL_ID, now, REASON, "browser_identity_retired", now, RETIRED_ID);

    if (injectFailure) txFail(String(injectFailure));

    // Critical postchecks INSIDE the same transaction: any throw rolls back.
    const after = captureState(db);
    const retired = after.retired;
    if (!retired || retired.browser_identity_canonical_id !== CANONICAL_ID) txFail("retired agent was not aliased to canonical");
    if (before.canonicalSnap && JSON.stringify(after.canonicalSnap) !== JSON.stringify(before.canonicalSnap)) txFail("canonical agent record changed");
    if (before.untouchedSnap && JSON.stringify(after.untouchedSnap) !== JSON.stringify(before.untouchedSnap)) txFail("untouched 5240c608 agent record changed");
    if (after.threadMessages.sha256 !== before.threadMessages.sha256 || after.threadMessages.count !== before.threadMessages.count) txFail("thread message summary changed (author/content/seq/id)");
    if (after.allMessages.sha256 !== before.allMessages.sha256 || after.allMessages.count !== before.allMessages.count) txFail("global message summary changed");
    if (after.threadSeats.includes(RETIRED_ID)) txFail("retired id still present in projected thread seats");
    if (!after.threadSeats.includes(CANONICAL_ID)) txFail("canonical id missing from projected thread seats");
    if (before.untouched && !after.threadSeats.includes(UNTOUCHED_ID) && before.threadSeats.includes(UNTOUCHED_ID)) txFail("untouched Muse seat removed unexpectedly");
    return after;
  });
  return tx(options && options.__inject_failure);
}

function openDb(dbPath) {
  const Driver = loadSqlite(dbPath);
  return Driver && Driver.__nodeSqlite ? Driver.open(dbPath) : new Driver(dbPath);
}

function openNodeDb(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  return wrapNodeSqlite(DatabaseSync, dbPath);
}

function main() {
  if (has("--self-test")) return selfTest();
  const dbPath = arg("--db");
  const apply = has("--apply");
  const report = {
    script: path.basename(__filename),
    mode: apply ? "apply" : "dry-run",
    ids: { retired: RETIRED_ID, canonical: CANONICAL_ID, untouched: UNTOUCHED_ID, thread: THREAD_ID },
    precheck: {},
    postcheck: {},
    ok: true,
  };
  if (!dbPath) fail(report, "--db <path> required");
  if (!fs.existsSync(dbPath)) fail(report, `db not found: ${dbPath}`);

  const db = openDb(dbPath);
  try {
    let before;
    try { before = captureState(db); }
    catch (e) { fail(report, e && e.message ? e.message : String(e)); }
    const { canonical, retired, untouched } = before;
    report.precheck.canonical = canonical ? { id: canonical.id, display_name: canonical.display_name, name: canonical.name, capabilities: canonical.capabilities, browser_identity_canonical_id: canonical.browser_identity_canonical_id } : null;
    report.precheck.retired = retired ? { id: retired.id, display_name: retired.display_name, name: retired.name, capabilities: retired.capabilities, browser_identity_canonical_id: retired.browser_identity_canonical_id } : null;
    report.precheck.untouched = untouched ? { id: untouched.id, display_name: untouched.display_name, browser_identity_canonical_id: untouched.browser_identity_canonical_id } : { note: "not present (ok if absent)" };
    report.precheck.untouched_full_snapshot_sha256 = before.untouchedSnap ? sha256(JSON.stringify(before.untouchedSnap)) : null;
    report.precheck.thread_seats_before = before.threadSeats;
    report.precheck.thread_seat_sources = {
      snapshot_key_present: before.threadSeatSources.snapshot.threadParticipantsKeyPresent,
      snapshot_thread_found: before.threadSeatSources.snapshot.threadFound,
      snapshot_participant_ids_count: before.threadSeatSources.snapshot.participantIds.length,
      union_participant_ids_count: before.threadSeatSources.participantCount,
    };
    report.precheck.thread_message_summary = before.threadMessages;
    report.precheck.global_message_summary = before.allMessages;

    if (!canonical) fail(report, "canonical agent not found");
    if (!retired) fail(report, "retired agent not found");
    if (canonical.browser_identity_canonical_id) fail(report, "canonical is already retired/aliased");
    if (retired.id === canonical.id) fail(report, "ids must differ");
    const hasBrowserUi = (caps) => { try { return (JSON.parse(caps || "[]") || []).includes("browser-ui"); } catch { return String(caps||"").includes("browser-ui"); } };
    if (!hasBrowserUi(canonical.capabilities) || !hasBrowserUi(retired.capabilities)) fail(report, "both agents must have browser-ui capability");
    const dependents = rows(db, "SELECT id, browser_identity_canonical_id FROM agents WHERE browser_identity_canonical_id = ? AND id != ?", [RETIRED_ID, RETIRED_ID]);
    if (dependents.length) fail(report, "alias chain prohibited: retired agent is canonical target for other aliases");
    if (retired.browser_identity_canonical_id && retired.browser_identity_canonical_id !== CANONICAL_ID) fail(report, "retired already aliased to a different canonical");
    if (untouched && untouched.browser_identity_canonical_id) report.precheck.warning_untouched_already_aliased = true;

    if (!apply) {
      report.planned = { action: "transaction: alias retired->canonical + postchecks (message summaries, 5240c608/canonical full rows, seats from snapshot+messages+thread_settings admins) before commit; any failure rolls back; no message/snapshot row rewrites" };
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    let after;
    try {
      after = runApply(db, before, {});
    } catch (e) {
      // Transaction rolled back on throw. Report failure without claiming apply.
      report.ok = false;
      report.error = e && e.message ? e.message : String(e);
      report.rolled_back = true;
      console.log(JSON.stringify(report, null, 2));
      process.exit(2);
    }

    report.postcheck.retired = { id: after.retired.id, browser_identity_canonical_id: after.retired.browser_identity_canonical_id, browser_identity_retired_reason: after.retired.browser_identity_retired_reason, is_online: after.retired.is_online };
    report.postcheck.canonical_unchanged = JSON.stringify(after.canonicalSnap) === JSON.stringify(before.canonicalSnap);
    report.postcheck.untouched_5240c608_full_row_unchanged = before.untouchedSnap ? JSON.stringify(after.untouchedSnap) === JSON.stringify(before.untouchedSnap) : null;
    report.postcheck.thread_seats_after = after.threadSeats;
    report.postcheck.thread_message_summary = after.threadMessages;
    report.postcheck.global_message_summary = after.allMessages;
    report.postcheck.transaction = "update+postchecks committed atomically; postcheck failure would throw and rollback";
    console.log(JSON.stringify(report, null, 2));
  } finally {
    db.close();
  }
}

// --- Self-test: basic unit/in-process checks (node:sqlite wrapper behavior,
// unique temp dirs). Full real-MemoryStore integration tests run via vitest
// (see deployment-review-A handoff). ---
function selfTest() {
  const os = require("os");
  const { DatabaseSync } = require("node:sqlite");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-migrate-selftest-"));
  const results = [];
  const dbPaths = [];
  try {
    function mkMinimal(name, opts = {}) {
      const dbPath = path.join(tmpDir, name);
      dbPaths.push(dbPath);
      const raw = new DatabaseSync(dbPath);
      raw.exec("CREATE TABLE agents (id TEXT PRIMARY KEY,name TEXT,display_name TEXT,alias_source TEXT,ide TEXT,model TEXT,description TEXT,is_online INTEGER,last_heartbeat TEXT,last_activity TEXT,last_activity_time TEXT,capabilities TEXT,skills TEXT,token TEXT,emoji TEXT,browser_identity_canonical_id TEXT,browser_identity_retired_at TEXT,browser_identity_retired_reason TEXT)");
      raw.exec("CREATE TABLE messages (id TEXT PRIMARY KEY,thread_id TEXT,seq INTEGER,author_id TEXT,author TEXT,author_name TEXT,author_emoji TEXT,role TEXT,content TEXT,metadata TEXT,reply_to_msg_id TEXT,priority TEXT,created_at TEXT,edited_at TEXT,edit_version INTEGER)");
      raw.exec("CREATE TABLE thread_settings (thread_id TEXT PRIMARY KEY,auto_administrator_enabled INTEGER,timeout_seconds INTEGER,switch_timeout_seconds INTEGER,last_activity_time TEXT,auto_assigned_admin_id TEXT,auto_assigned_admin_name TEXT,admin_assignment_time TEXT,creator_admin_id TEXT,creator_admin_name TEXT,creator_assignment_time TEXT)");
      raw.exec("CREATE TABLE state_snapshots (id INTEGER PRIMARY KEY,payload TEXT,updated_at TEXT)");
      const ins = raw.prepare('INSERT INTO agents (id,name,display_name,ide,model,description,is_online,last_heartbeat,capabilities,token) VALUES (?,?,?,?,?,?,0,?,?,?)');
      ins.run(CANONICAL_ID,'Muse (Web session) 4','Muse · Marley','Muse','Web session','c',new Date().toISOString(),JSON.stringify(['browser-ui','web-session-presence']),'tok-canonical');
      ins.run(RETIRED_ID,'Browser (Browser Agent (Muse))','Muse · Marley','Browser','Browser Agent (Muse)','Independent browser-agent identity',new Date().toISOString(),JSON.stringify(['browser-ui','chat']),'tok-retired-old-cred');
      ins.run(UNTOUCHED_ID,'Muse (Web session) 3','Muse','Muse','Web session','u',new Date().toISOString(),JSON.stringify(['browser-ui','web-session-presence']),'tok-untouched');
      const participants = opts.participants || [CANONICAL_ID, RETIRED_ID, UNTOUCHED_ID];
      const payload = { threadParticipants: [[THREAD_ID, participants]], threadSettings: opts.threadSettings || [], threads: [], threadMessages: [], humanOnlyMessages: [], threadWaitStates: [], agents: [], syncTokens: [], logEntries: [], ideSessions: [], ideOwnerInstanceId: null, logCursor: 0, sequence: 1, messageEditHistory: [] };
      raw.prepare("INSERT INTO state_snapshots (id,payload,updated_at) VALUES (1,?,?)").run(JSON.stringify(payload), new Date().toISOString());
      raw.prepare("INSERT INTO thread_settings (thread_id,auto_administrator_enabled,timeout_seconds,switch_timeout_seconds,last_activity_time) VALUES (?,?,?,?,?)").run(THREAD_ID,1,60,60,new Date().toISOString());
      if (!opts.noMessage) {
        raw.prepare("INSERT INTO messages (id,thread_id,seq,author_id,author,author_name,role,content,metadata,priority,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run('m1',THREAD_ID,1,RETIRED_ID,RETIRED_ID,'Muse · Marley','assistant','history from duplicate','{"visibility":"public"}','normal',new Date().toISOString());
      }
      raw.close();
      return dbPath;
    }

    // 1) node:sqlite path apply (CLI) - preserves history/unconfirmed/old credential row.
    const dbPath1 = mkMinimal("apply.db");
    const r1 = require("child_process").spawnSync(process.execPath, [__filename, "--db", dbPath1, "--apply"], { encoding: "utf8" });
    if (r1.status !== 0) throw new Error("self-test apply failed: " + (r1.stdout||r1.stderr).slice(0,500));
    const out1 = JSON.parse(r1.stdout);
    if (!out1.ok) throw new Error("self-test apply not ok");
    const db1 = openNodeDb(dbPath1);
    try {
      const retired = row(db1, "SELECT * FROM agents WHERE id=?", [RETIRED_ID]);
      const canonical = row(db1, "SELECT * FROM agents WHERE id=?", [CANONICAL_ID]);
      const untouched = row(db1, "SELECT * FROM agents WHERE id=?", [UNTOUCHED_ID]);
      const msg = row(db1, "SELECT content,author_id,seq FROM messages WHERE id='m1'");
      if (retired.browser_identity_canonical_id !== CANONICAL_ID) throw new Error("retired not aliased");
      if (retired.token !== 'tok-retired-old-cred') throw new Error("old credential row/token changed");
      if (canonical.browser_identity_canonical_id) throw new Error("canonical aliased unexpectedly");
      if (String(untouched.display_name) !== 'Muse' || untouched.browser_identity_canonical_id) throw new Error("5240c608 changed");
      if (!msg || msg.content !== 'history from duplicate' || msg.author_id !== RETIRED_ID || msg.seq !== 1) throw new Error("message changed");
    } finally { db1.close(); }
    results.push("apply_isolated_copy_preserves_history_unconfirmed_muse_and_old_credential_row");

    // 2) REAL runApply rollback on node:sqlite wrapper (no hand-written tx bypass).
    const dbPath2 = mkMinimal("rollback-node.db");
    const db2 = openNodeDb(dbPath2);
    try {
      const before = captureState(db2);
      const beforeRet = JSON.stringify(stableRowSnapshot(before.retired));
      const beforeCan = JSON.stringify(before.canonicalSnap);
      const beforeUnt = JSON.stringify(before.untouchedSnap);
      const beforeMsgs = before.allMessages.sha256;
      let threw = false;
      try { runApply(db2, before, { __inject_failure: "injected postcheck failure (node:sqlite)" }); }
      catch (e) { threw = true; if (!String(e.message).includes("injected postcheck failure")) throw e; }
      if (!threw) throw new Error("runApply did not throw on injected failure (node:sqlite)");
      const after = captureState(db2);
      if (JSON.stringify(stableRowSnapshot(after.retired)) !== beforeRet) throw new Error("node:sqlite rollback changed retired state");
      if (JSON.stringify(after.canonicalSnap) !== beforeCan) throw new Error("node:sqlite rollback changed canonical");
      if (JSON.stringify(after.untouchedSnap) !== beforeUnt) throw new Error("node:sqlite rollback changed 5240c608");
      if (after.allMessages.sha256 !== beforeMsgs) throw new Error("node:sqlite rollback changed message summary");
    } finally { db2.close(); }
    results.push("runApply_real_transaction_rollback_node_sqlite_path");

    // 3) better-sqlite3-compatible transaction contract: arg forwarding + rollback via actual runApply.
    const dbPath3 = mkMinimal("rollback-bsql.db");
    const raw3 = openNodeDb(dbPath3);
    try {
      const before = captureState(raw3);
      const beforeRet = JSON.stringify(stableRowSnapshot(before.retired));
      const beforeUnt = JSON.stringify(before.untouchedSnap);
      let receivedArg;
      const bsqlLike = {
        prepare: (sql) => raw3.prepare(sql),
        exec: (sql) => raw3.exec(sql),
        transaction: (fn) => (...args) => { raw3.exec("BEGIN"); try { const r = fn(...args); raw3.exec("COMMIT"); return r; } catch (e) { try { raw3.exec("ROLLBACK"); } catch {} throw e; } },
        close: () => raw3.close(),
      };
      const origTx = bsqlLike.transaction.bind(bsqlLike);
      bsqlLike.transaction = (fn) => origTx((...args) => { receivedArg = args[0]; return fn(...args); });
      let threw = false;
      try { runApply(bsqlLike, before, { __inject_failure: "injected postcheck failure (bsql contract)" }); } catch (e) { threw = true; }
      if (!threw) throw new Error("runApply did not throw (bsql contract)");
      if (String(receivedArg) !== "injected postcheck failure (bsql contract)") throw new Error("transaction arg not forwarded");
      const after = captureState(raw3);
      if (JSON.stringify(stableRowSnapshot(after.retired)) !== beforeRet) throw new Error("bsql contract rollback failed (retired)");
      if (JSON.stringify(after.untouchedSnap) !== beforeUnt) throw new Error("bsql contract rollback changed 5240c608");
    } finally { try { raw3.close(); } catch {} }
    results.push("runApply_transaction_arg_forwarding_and_rollback_better_sqlite3_contract_shim");

    // 4) snapshot-only participant (retired in snapshot, no messages by retired) is detected in seats precheck.
    const dbPath4 = mkMinimal("snapshot-only.db", { noMessage: true, participants: [CANONICAL_ID, RETIRED_ID, UNTOUCHED_ID] });
    const db4 = openNodeDb(dbPath4);
    try {
      const proj = projectedThreadSeatIds(db4, THREAD_ID);
      if (!proj.seats.includes(CANONICAL_ID)) throw new Error("snapshot-only: canonical missing from projected seats");
      if (!proj.seats.includes(RETIRED_ID)) throw new Error("snapshot-only: retired participant missing from projected seats (would be silently dropped)");
      if (!proj.sources.snapshot.threadParticipantsKeyPresent) throw new Error("snapshot-only: snapshot participants not detected");
    } finally { db4.close(); }
    results.push("snapshot_only_participant_detected_without_messages");

    // 5) corrupt snapshot => clear error (no silent drop).
    const dbPath5 = mkMinimal("corrupt.db");
    const raw5 = new DatabaseSync(dbPath5);
    raw5.prepare("UPDATE state_snapshots SET payload = ? WHERE id=1").run("{not-json");
    raw5.close();
    const db5 = openNodeDb(dbPath5);
    try {
      let err = null;
      try { captureState(db5); } catch (e) { err = e; }
      if (!err || !String(err.message).includes("SNAPSHOT_CORRUPT")) throw new Error("corrupt snapshot must fail clearly, got: " + (err ? err.message : "no error"));
    } finally { db5.close(); }
    results.push("corrupt_snapshot_rejected_clearly");

    console.log(JSON.stringify({ ok: true, tmpDirUsed: path.basename(tmpDir), tests: results, notes: {
      node_sqlite: "real SQLite rollback via node:sqlite wrapper + actual runApply",
      better_sqlite3: "actual runApply exercised through better-sqlite3-compatible transaction(fn)(...args) contract with real SQLite state; native better-sqlite3 binary not installed in this workspace",
      full_integration: "real MemoryStore disk/reopen integration tests run via vitest (deployment-review-A)"
    }}, null, 2));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

if (require.main === module) main();
module.exports = { wrapNodeSqlite, loadSqlite, openDb, openNodeDb, messageDigest, captureState, runApply, stableRowSnapshot, row, rows, projectedThreadSeatIds, readSnapshotThreadParticipants, assertRealSchema, tableExists, tableColumns, CONSTANTS: { RETIRED_ID, CANONICAL_ID, UNTOUCHED_ID, THREAD_ID, REASON } };
