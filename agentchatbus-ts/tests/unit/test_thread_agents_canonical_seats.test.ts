import { describe, expect, it, beforeEach } from "vitest";
import { MemoryStore } from "../../src/core/services/memoryStore.js";

describe("thread agent seats - canonical projection / no extra alias seats", () => {
  let store: MemoryStore;
  beforeEach(() => {
    process.env.AGENTCHATBUS_TEST_DB = ":memory:";
    store = new MemoryStore(":memory:");
  });

  function browserAgent(name: string, id?: string) {
    const a = store.registerAgent({ ide: "Muse", model: "Web session", display_name: name, capabilities: ["browser-ui", "web-session-presence"] });
    return store.getAgent(a.id)!;
  }

  it("getThreadAgents projects retired alias participant to canonical seat (no extra seat)", () => {
    const canonical = browserAgent("Muse · Marley");
    const retired = browserAgent("Muse · Marley");
    const thread = store.createThread("t").thread;
    // simulate participant/history reference to retired id
    (store as any).threadParticipants.set(thread.id, new Set([retired.id]));
    (store as any).upsertAgent({ ...retired, browser_identity_canonical_id: canonical.id, browser_identity_retired_at: new Date().toISOString(), browser_identity_retired_reason: "test" });

    const seats = store.getThreadAgents(thread.id);
    expect(seats.map(s => s.id)).toEqual([canonical.id]);
    expect(seats).toHaveLength(1);
  });

  it("getThreadAgents does not duplicate when both retired and canonical appear as sources", () => {
    const canonical = browserAgent("Muse · Marley");
    const retired = browserAgent("Muse · Marley");
    const thread = store.createThread("t").thread;
    (store as any).threadParticipants.set(thread.id, new Set([retired.id, canonical.id]));
    (store as any).upsertAgent({ ...retired, browser_identity_canonical_id: canonical.id, browser_identity_retired_at: new Date().toISOString(), browser_identity_retired_reason: "test" });

    const seats = store.getThreadAgents(thread.id);
    expect(seats.map(s => s.id).sort()).toEqual([canonical.id]);
  });

  it("same display name, different real identities (no alias) are NOT swallowed", () => {
    const a = browserAgent("Muse · Marley");
    const b = browserAgent("Muse · Marley");
    const thread = store.createThread("t").thread;
    (store as any).threadParticipants.set(thread.id, new Set([a.id, b.id]));
    const seats = store.getThreadAgents(thread.id);
    expect(new Set(seats.map(s => s.id))).toEqual(new Set([a.id, b.id]));
    expect(seats).toHaveLength(2);
  });

  it("listAgents default excludes retired aliases", () => {
    const canonical = browserAgent("Muse · Marley");
    const retired = browserAgent("Muse · Marley");
    (store as any).upsertAgent({ ...retired, browser_identity_canonical_id: canonical.id, browser_identity_retired_at: new Date().toISOString(), browser_identity_retired_reason: "test" });
    const ids = store.listAgents().map(a => a.id);
    expect(ids).toContain(canonical.id);
    expect(ids).not.toContain(retired.id);
  });
});
