import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MemoryStore } from "../../core/services/memoryStore.js";

type Req = FastifyRequest<{ Params: Record<string, string>; Querystring: Record<string, string | undefined>; Body?: unknown }>;

/**
 * Directed-message task receipts (real ack, manual pull; no auto-wake).
 * Codex mounts in server.ts: registerTaskReceiptRoutes(server, store)
 */
export function registerTaskReceiptRoutes(server: FastifyInstance, store: MemoryStore): void {
  const json = (reply: FastifyReply, code: number, body: unknown) => reply.code(code).type("application/json").send(body);

  // Auth for agent self-update only. Do not accept admin/site auth as claim.
  function requireTargetAgent(request: Req, reply: FastifyReply, expectedAgentId: string): string | null {
    const agentId = String(request.headers["x-agent-id"] || "").trim();
    const token = String(request.headers["x-agent-token"] || "").trim();
    if (!agentId || !token) {
      void json(reply, 401, { error: "UNAUTHORIZED", detail: "X-Agent-Id and X-Agent-Token headers required" });
      return null;
    }
    if (agentId !== expectedAgentId) {
      void json(reply, 403, { error: "FORBIDDEN", detail: "Only the real target agent may update its own receipt" });
      return null;
    }
    if (!store.verifyAgentToken(agentId, token)) {
      void json(reply, 401, { error: "UNAUTHORIZED", detail: "Invalid agent credentials" });
      return null;
    }
    return agentId;
  }

  // GET /api/threads/:threadId/task-receipts?after_seq=0&limit=200
  server.get("/api/threads/:threadId/task-receipts", async (request, reply) => {
    const req = request as Req;
    const threadId = req.params.threadId;
    const afterSeq = Number(req.query?.after_seq || 0);
    const requestedLimit = Number(req.query?.limit || 200);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) return json(reply, 400, { error: "INVALID_PAGINATION" });
    const limit = Math.min(200, requestedLimit);
    const thread = store.getThread(threadId);
    if (!thread) return json(reply, 404, { error: "THREAD_NOT_FOUND" });
    const result = store.listTaskReceipts({ threadId, afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0, limit });
    // Never expose tokens. detail may be present in persisted state; sanitize defensively.
    const receipts = result.receipts.map((r: any) => ({
      message_id: r.message_id,
      message_seq: r.message_seq,
      target_agent_id: r.target_agent_id,
      status: r.status,
      delivery_mode: "manual_pull",
      can_auto_wake: false,
      connection_type: r.connection_type,
      updated_at: r.updated_at,
      // version included for client ack flow; GET contract states initial version 0 semantics via data
      version: r.version,
    }));
    return json(reply, 200, { receipts, has_more: result.has_more, next_seq: result.next_seq });
  });

  // POST /api/threads/:threadId/messages/:messageId/task-receipts/:agentId
  server.post("/api/threads/:threadId/messages/:messageId/task-receipts/:agentId", async (request, reply) => {
    const req = request as Req;
    const { threadId, messageId, agentId } = req.params;
    // Auth BEFORE any sensitive lookup that could confirm existence beyond what's needed.
    const authed = requireTargetAgent(req, reply, agentId);
    if (!authed) return;

    const body = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>) : {};
    const status = typeof body.status === "string" ? body.status : "";
    const expectedVersion = body.expected_version;
    if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return json(reply, 400, { error: "INVALID_EXPECTED_VERSION", detail: "expected_version must be a non-negative integer" });
    }
    const detail = typeof body.detail === "string" ? body.detail.slice(0, 1000) : undefined;
    // detail is plain text; never accept/store tokens (best-effort: caller responsibility; we do not inject secrets)

    const result = store.acknowledgeTaskReceipt({
      threadId,
      messageId,
      targetAgentId: agentId,
      status,
      expectedVersion,
      detail,
    });
    if (!result.ok) {
      const payload: any = { error: result.error, detail: result.detail };
      if (result.receipt) payload.receipt = sanitizeReceipt(result.receipt);
      return json(reply, result.code, payload);
    }
    return json(reply, 200, { receipt: sanitizeReceipt(result.receipt) });
  });
}

function sanitizeReceipt(r: any) {
  if (!r || typeof r !== "object") return r;
  const out: any = {
    message_id: r.message_id,
    message_seq: r.message_seq,
    target_agent_id: r.target_agent_id,
    status: r.status,
    delivery_mode: "manual_pull",
    can_auto_wake: false,
    connection_type: r.connection_type || "unknown",
    updated_at: r.updated_at,
    version: r.version,
  };
  if (typeof r.detail === "string" && r.detail) out.detail = r.detail;
  return out;
}
