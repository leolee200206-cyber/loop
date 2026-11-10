(function () {
  const cliActivityConfig = {
    getActiveThreadId: null,
    scrollBottom: null,
    resolveActivityIdentity: null,
    hideTyping: null,
  };
  const cliActivityCards = new Map();
  const cliActivityPendingRows = new Map();
  const cliActivitySessionsByThread = new Map();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getThreadActivityCache(threadId) {
    const key = String(threadId || "").trim();
    if (!key) {
      return null;
    }
    let bucket = cliActivitySessionsByThread.get(key);
    if (!bucket) {
      bucket = new Map();
      cliActivitySessionsByThread.set(key, bucket);
    }
    return bucket;
  }

  function setCliActivityConfig(config = {}) {
    Object.assign(cliActivityConfig, config || {});
  }

  function getNativeCard(sessionId) {
    const card = cliActivityCards.get(String(sessionId || ""));
    if (card && card.isConnected) {
      return card;
    }
    if (card) {
      cliActivityCards.delete(String(sessionId || ""));
    }
    return null;
  }

  function getPendingRow(sessionId) {
    const row = cliActivityPendingRows.get(String(sessionId || ""));
    if (row && row.isConnected) {
      return row;
    }
    if (row) {
      cliActivityPendingRows.delete(String(sessionId || ""));
    }
    return null;
  }

  function removeCliActivitySession(sessionId, threadId = null) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return;
    }
    const normalizedThreadId = String(threadId || "").trim();
    const card = cliActivityCards.get(normalizedSessionId);
    if (card) {
      const cardThreadId = String(card.dataset.threadId || "").trim();
      if (!normalizedThreadId || !cardThreadId || cardThreadId === normalizedThreadId) {
        card.remove();
      }
      cliActivityCards.delete(normalizedSessionId);
    }
    const row = cliActivityPendingRows.get(normalizedSessionId);
    if (row) {
      const rowThreadId = String(row.dataset.threadId || "").trim();
      if (!normalizedThreadId || !rowThreadId || rowThreadId === normalizedThreadId) {
        row.remove();
      }
      cliActivityPendingRows.delete(normalizedSessionId);
    }
    if (normalizedThreadId) {
      const cache = getThreadActivityCache(normalizedThreadId);
      cache?.delete(normalizedSessionId);
    }
  }

  function clearCliActivityRows(threadId = null, clearCache = true) {
    const normalizedThreadId = String(threadId || "").trim();
    for (const [sessionId, card] of cliActivityCards.entries()) {
      if (!card) continue;
      if (!normalizedThreadId || String(card.dataset.threadId || "") === normalizedThreadId) {
        card.remove();
        cliActivityCards.delete(sessionId);
      }
    }
    for (const [sessionId, row] of cliActivityPendingRows.entries()) {
      if (!row) continue;
      if (!normalizedThreadId || String(row.dataset.threadId || "") === normalizedThreadId) {
        row.remove();
        cliActivityPendingRows.delete(sessionId);
      }
    }
    if (!normalizedThreadId) {
      if (!clearCache) {
        return;
      }
      cliActivitySessionsByThread.clear();
      return;
    }
    if (clearCache) {
      cliActivitySessionsByThread.delete(normalizedThreadId);
    }
  }

  function clearCliActivityForAuthor(authorId) {
    const targetAuthorId = String(authorId || "").trim();
    if (!targetAuthorId) {
      return;
    }
    const activeThreadId = typeof cliActivityConfig.getActiveThreadId === "function"
      ? String(cliActivityConfig.getActiveThreadId() || "").trim()
      : "";
    const cache = getThreadActivityCache(activeThreadId);
    if (!cache) {
      return;
    }
    for (const session of cache.values()) {
      const sessionAuthorId = String(session?.participant_agent_id || session?.id || "").trim();
      if (sessionAuthorId !== targetAuthorId) {
        continue;
      }
      renderCliActivitySession(session, false);
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value || ""));
    }
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function formatActivityTime(value) {
    const stamp = String(value || "").trim();
    if (!stamp) {
      return "";
    }
    const parsed = new Date(stamp);
    if (Number.isNaN(parsed.getTime())) {
      return stamp;
    }
    return parsed.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function getSessionAdapterLabel(session) {
    const normalized = String(session?.adapter || "codex").trim().toLowerCase();
    if (normalized === "claude") return "Claude";
    if (normalized === "cursor") return "Cursor";
    if (normalized === "gemini") return "Gemini";
    if (normalized === "copilot") return "Copilot";
    return "Codex";
  }

  function normalizeShellStatusText(session) {
    const card = session?.native_activity_card;
    if (card?.shell_status_text) {
      return String(card.shell_status_text).trim();
    }
    const runtime = session?.native_turn_runtime;
    const flags = Array.isArray(runtime?.thread_active_flags) ? runtime.thread_active_flags : [];
    const phase = String(runtime?.phase || "").trim();
    const state = String(session?.state || "").trim().toLowerCase();
    const adapterLabel = getSessionAdapterLabel(session);
    if (state === "failed") return "Failed";
    if (state === "stopped") return "Stopped";
    if (state === "completed") return "Completed";
    if (state === "starting" || state === "created") return `Starting ${adapterLabel}`;
    if (flags.includes("waitingOnApproval")) return "Waiting on approval";
    if (flags.includes("waitingOnUserInput")) return "Waiting on input";
    if (phase === "interrupting") return "Interrupting";
    if (phase === "running" || phase === "starting") return "Thinking";
    if (phase === "completed") return "Completed";
    if (phase === "interrupted") return "Interrupted";
    if (session?.connected_at) return "Connected";
    return "Running";
  }

  function buildFallbackNativeCard(session) {
    const adapterLabel = getSessionAdapterLabel(session);
    const shellStatusText = normalizeShellStatusText(session);
    const runtime = session?.native_turn_runtime;
    const flags = Array.isArray(runtime?.thread_active_flags) ? runtime.thread_active_flags : [];
    const phase = String(runtime?.phase || "").trim();
    const shellStatus = String(session?.state || "").trim().toLowerCase();
    const waitingOnApproval = flags.includes("waitingOnApproval");
    const waitingOnInput = flags.includes("waitingOnUserInput");
    const running = phase === "starting" || phase === "running" || phase === "interrupting";
    const placeholderSummary = shellStatus === "starting" || shellStatus === "created"
      ? `${adapterLabel} is starting.`
      : shellStatus === "failed"
        ? `${adapterLabel} stopped after an error.`
        : shellStatus === "stopped"
          ? `${adapterLabel} session stopped.`
          : shellStatus === "completed"
            ? `Last ${adapterLabel} task completed.`
            : waitingOnApproval
              ? "Waiting for approval before continuing."
              : waitingOnInput
                ? "Waiting for input to continue."
                : running
                  ? "Working through the next steps."
                  : `Connected and waiting for the next ${adapterLabel} task.`;
    const placeholderKind = waitingOnApproval || waitingOnInput || running ? "thinking" : "placeholder";
    const placeholderStatus = waitingOnApproval || waitingOnInput || running ? "in_progress" : "placeholder";
    return {
      anchor_message_id: String(session?.last_posted_message_id || "").trim() || "",
      shell_status: (
        shellStatus === "failed"
          ? "failed"
          : shellStatus === "stopped"
            ? "stopped"
            : shellStatus === "completed"
              ? "completed"
              : session?.connected_at
                ? "connected"
                : shellStatus === "starting" || shellStatus === "created"
                  ? "starting"
                  : "running"
      ),
      shell_status_text: shellStatusText,
      updated_at: String(
        session?.updated_at
        || session?.last_output_at
        || session?.last_tool_call_at
        || session?.created_at
        || "",
      ),
      placeholder_visible: placeholderKind === "placeholder",
      content_sections: [
        {
          kind: placeholderKind,
          title: placeholderKind === "thinking" ? "Thinking" : "Activity",
          summary: placeholderSummary,
          status: placeholderStatus,
          meta: shellStatusText,
        },
      ],
    };
  }

  function getNativeCardModel(session) {
    if (!session || !session.id) {
      return null;
    }
    const card = session.native_activity_card && typeof session.native_activity_card === "object"
      ? session.native_activity_card
      : buildFallbackNativeCard(session);
    const sections = Array.isArray(card.content_sections) ? card.content_sections : [];
    if (!sections.length) {
      return buildFallbackNativeCard(session);
    }
    return {
      ...card,
      session,
      shell_status_text: String(card.shell_status_text || normalizeShellStatusText(session)).trim(),
      updated_at: String(
        card.updated_at
        || session.updated_at
        || session.last_output_at
        || session.last_tool_call_at
        || session.created_at
        || "",
      ).trim(),
      content_blocks: Array.isArray(card.content_blocks) ? card.content_blocks : [],
      content_sections: sections,
    };
  }

  function getNativeCardAction(session) {
    const runtime = session?.native_turn_runtime;
    const phase = String(runtime?.phase || "").trim();
    const flags = Array.isArray(runtime?.thread_active_flags) ? runtime.thread_active_flags : [];
    const active = phase === "starting" || phase === "running" || phase === "interrupting";
    const detail = flags.includes("waitingOnApproval")
      ? "Waiting on approval"
      : flags.includes("waitingOnUserInput")
        ? "Waiting on input"
        : phase === "interrupting"
          ? "Interrupting"
          : active
            ? "Running"
            : "Idle";
    return {
      state: active ? "running" : "idle",
      detail,
      ariaLabel: active
        ? `${getSessionAdapterLabel(session)} active: ${detail}`
        : `${getSessionAdapterLabel(session)} idle: ${detail}`,
    };
  }

  function buildNativeCardActionGlyph(actionState) {
    return `
      <span class="msg-native-card__action-glyph" aria-hidden="true">
        <svg class="msg-native-card__action-icon" viewBox="0 0 28 18" focusable="false">
          <rect class="msg-native-card__action-cell msg-native-card__action-cell--left" x="3" y="4" width="8" height="10" rx="2"></rect>
          <rect class="msg-native-card__action-cell msg-native-card__action-cell--right" x="17" y="4" width="8" height="10" rx="2"></rect>
        </svg>
      </span>
    `;
  }

  function getItemStatusLabel(item) {
    const status = String(item?.status || "").trim();
    if (status === "in_progress") {
      return "Running";
    }
    if (status === "completed") {
      return "Done";
    }
    if (status === "failed" || status === "declined") {
      return "Failed";
    }
    return "";
  }

  function buildSectionItemsHtml(section) {
    const items = Array.isArray(section?.items) ? section.items : [];
    if (!items.length) {
      return "";
    }
    if (section.kind === "plan") {
      return `
        <div class="msg-native-card__plan">
          ${items.map((item) => `
            <div class="msg-native-card__plan-step" data-status="${escapeHtml(item.status || "")}">
              <span class="msg-native-card__plan-dot"></span>
              <span>${escapeHtml(item.label || "")}</span>
            </div>
          `).join("")}
        </div>
      `;
    }
    return `
      <div class="msg-native-card__items">
        ${items.map((item) => `
          <div class="msg-native-card__item" data-kind="${escapeHtml(item.kind || "")}" data-status="${escapeHtml(item.status || "")}">
            <div class="msg-native-card__item-main">
              <span class="msg-native-card__item-label">${escapeHtml(item.label || "")}</span>
              ${item.value ? `<span class="msg-native-card__item-value ${(section.kind === "command" || section.kind === "files" || item.kind === "cwd") ? "msg-native-card__item-value--mono" : ""}">${escapeHtml(item.value)}</span>` : ""}
            </div>
            ${getItemStatusLabel(item) ? `<span class="msg-native-card__item-badge" data-status="${escapeHtml(item.status || "")}">${escapeHtml(getItemStatusLabel(item))}</span>` : ""}
          </div>
        `).join("")}
      </div>
    `;
  }

  function getSectionStatusLabel(section) {
    const status = String(section?.status || "").trim();
    if (status === "in_progress") {
      return "Running";
    }
    if (status === "completed") {
      return "Done";
    }
    if (status === "failed") {
      return "Failed";
    }
    if (status === "placeholder") {
      return "Idle";
    }
    return "";
  }

  function buildSectionHtml(section) {
    if (!section || typeof section !== "object") {
      return "";
    }
    const summary = String(section.summary || "").trim();
    const meta = String(section.meta || "").trim();
    const statusLabel = getSectionStatusLabel(section);
    return `
      <section class="msg-native-card__section" data-kind="${escapeHtml(section.kind || "placeholder")}" data-status="${escapeHtml(section.status || "placeholder")}">
        <div class="msg-native-card__section-head">
          <div class="msg-native-card__section-title">${escapeHtml(section.title || "Activity")}</div>
          ${statusLabel ? `<span class="msg-native-card__section-badge" data-status="${escapeHtml(section.status || "placeholder")}">${escapeHtml(statusLabel)}</span>` : ""}
        </div>
        <div class="msg-native-card__section-summary">${escapeHtml(summary || "No active agent activity to display.")}</div>
        ${meta ? `<div class="msg-native-card__section-meta">${escapeHtml(meta)}</div>` : ""}
        ${section.kind === "diff" ? `<pre class="msg-native-card__diff">${escapeHtml(summary || "")}</pre>` : ""}
        ${buildSectionItemsHtml(section)}
      </section>
    `;
  }

  function buildBlockItemsHtml(block) {
    const items = Array.isArray(block?.items) ? block.items : [];
    if (!items.length) {
      return "";
    }
    if (block.kind === "plan") {
      return `
        <div class="msg-native-card__plan">
          ${items.map((item) => `
            <div class="msg-native-card__plan-step" data-status="${escapeHtml(item.status || "")}">
              <span class="msg-native-card__plan-dot"></span>
              <span>${escapeHtml(item.label || "")}</span>
            </div>
          `).join("")}
        </div>
      `;
    }
    return `
      <div class="msg-native-card__items">
        ${items.map((item) => `
          <div class="msg-native-card__item" data-kind="${escapeHtml(item.kind || "")}" data-status="${escapeHtml(item.status || "")}">
            <div class="msg-native-card__item-main">
              <span class="msg-native-card__item-label">${escapeHtml(item.label || "")}</span>
              ${item.value ? `<span class="msg-native-card__item-value ${(block.kind === "command" || block.kind === "files" || item.kind === "cwd") ? "msg-native-card__item-value--mono" : ""}">${escapeHtml(item.value)}</span>` : ""}
            </div>
            ${getItemStatusLabel(item) ? `<span class="msg-native-card__item-badge" data-status="${escapeHtml(item.status || "")}">${escapeHtml(getItemStatusLabel(item))}</span>` : ""}
          </div>
        `).join("")}
      </div>
    `;
  }

  function buildBlockHtml(block) {
    if (!block || typeof block !== "object") {
      return "";
    }
    const title = String(block.title || "Activity").trim();
    const summary = String(block.summary || "").trim();
    const meta = String(block.meta || "").trim();
    const content = String(block.content || "").trim();
    const diff = String(block.diff || "").trim();
    const statusLabel = getSectionStatusLabel(block);
    const showSummary = block.kind === "message" ? Boolean(summary && !content) : Boolean(summary);
    const showContent = Boolean(content);
    const showDiff = Boolean(diff && block.kind === "diff");
    return `
      <section class="msg-native-card__block" data-kind="${escapeHtml(block.kind || "placeholder")}" data-status="${escapeHtml(block.status || "placeholder")}">
        <div class="msg-native-card__block-head">
          <div class="msg-native-card__block-title">${escapeHtml(title)}</div>
          ${statusLabel ? `<span class="msg-native-card__block-badge" data-status="${escapeHtml(block.status || "placeholder")}">${escapeHtml(statusLabel)}</span>` : ""}
        </div>
        ${showSummary ? `<div class="msg-native-card__block-summary">${escapeHtml(summary)}</div>` : ""}
        ${meta ? `<div class="msg-native-card__block-meta">${escapeHtml(meta)}</div>` : ""}
        ${showContent ? `<div class="msg-native-card__block-content ${block.kind === "message" ? "msg-native-card__block-content--message" : ""}">${escapeHtml(content)}</div>` : ""}
        ${showDiff ? `<pre class="msg-native-card__diff">${escapeHtml(diff)}</pre>` : ""}
        ${buildBlockItemsHtml(block)}
      </section>
    `;
  }

  function getReentryPromptState(session) {
    const state = session?.reentry_prompt;
    return state && typeof state === "object" ? state : null;
  }

  function buildNativePromptBlockHtml(title, prompt, meta = "") {
    const normalizedPrompt = String(prompt || "").trim();
    if (!normalizedPrompt) {
      return "";
    }
    const normalizedMeta = String(meta || "").trim();
    return `
      <section class="msg-native-card__prompt">
        <div class="msg-native-card__prompt-title">${escapeHtml(title)}</div>
        ${normalizedMeta ? `<div class="msg-native-card__prompt-meta">${escapeHtml(normalizedMeta)}</div>` : ""}
        <pre class="msg-native-card__prompt-body">${escapeHtml(normalizedPrompt)}</pre>
      </section>
    `;
  }

  function buildNativePromptPanelsHtml(session) {
    return "";
  }

  function buildNativeCardHtml(model, actionState) {
    const blocks = Array.isArray(model.content_blocks) ? model.content_blocks : [];
    const useBlocks = blocks.length > 0;
    return `
      <div class="msg-native-card__header">
        <span class="msg-native-card__status">${escapeHtml(model.shell_status_text || "Connected")}</span>
        <span class="msg-native-card__time">${escapeHtml(model.updated_at ? formatActivityTime(model.updated_at) : "")}</span>
      </div>
      <div class="msg-native-card__body">
        ${useBlocks
          ? blocks.map((block) => buildBlockHtml(block)).join("")
          : model.content_sections.map((section) => buildSectionHtml(section)).join("")}
      </div>
      ${buildNativePromptPanelsHtml(model.session)}
      <div class="msg-native-card__footer">
        <span class="msg-native-card__footer-note">${escapeHtml(actionState?.detail || "Idle")}</span>
        <button
          type="button"
          class="msg-native-card__action"
          data-state="${escapeHtml(actionState?.state || "idle")}"
          disabled
          aria-disabled="true"
          aria-label="${escapeHtml(actionState?.ariaLabel || "Agent idle")}"
          tabindex="-1"
          title="${escapeHtml(actionState?.ariaLabel || "Agent idle")}"
        >${buildNativeCardActionGlyph(actionState)}</button>
      </div>
    `;
  }

  function resolveActivityIdentity(session) {
    return typeof cliActivityConfig.resolveActivityIdentity === "function"
      ? cliActivityConfig.resolveActivityIdentity(session) || {}
      : {};
  }

  function getLatestMessageRow(threadId, authorId, anchorMessageId) {
    const activeThreadId = typeof cliActivityConfig.getActiveThreadId === "function"
      ? String(cliActivityConfig.getActiveThreadId() || "").trim()
      : "";
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId || normalizedThreadId !== activeThreadId) {
      return null;
    }
    const anchorId = String(anchorMessageId || "").trim();
    if (anchorId) {
      const anchoredRow = document.querySelector(`#messages .msg-row[data-msg-id="${cssEscape(anchorId)}"]`);
      if (anchoredRow) {
        return anchoredRow;
      }
    }
    const normalizedAuthorId = String(authorId || "").trim();
    if (!normalizedAuthorId) {
      return null;
    }
    const rows = Array.from(document.querySelectorAll(`#messages .msg-row[data-seq][data-author-id="${cssEscape(normalizedAuthorId)}"]`));
    return rows.length ? rows[rows.length - 1] : null;
  }

  function ensurePendingRow(session, identity) {
    const existing = getPendingRow(session.id);
    if (existing) {
      return existing;
    }
    const box = document.getElementById("messages");
    if (!box) {
      return null;
    }
    const color = String(identity.color || "var(--accent)").trim() || "var(--accent)";
    const avatarEmoji = String(identity.avatarEmoji || "🤖").trim() || "🤖";
    const authorLabel = String(identity.authorLabel || session?.participant_display_name || "Agent").trim() || "Agent";
    const authorId = String(identity.authorId || session?.participant_agent_id || session?.id || "").trim();
    const row = document.createElement("div");
    row.className = "msg-row msg-row-left msg-row-cli-native-pending";
    row.dataset.threadId = String(session?.thread_id || "").trim();
    row.dataset.sessionId = String(session?.id || "").trim();
    row.dataset.authorId = authorId;
    row.innerHTML = `
      <div class="msg-avatar" style="background:${escapeHtml(color)}22;color:${escapeHtml(color)};border:1px solid ${escapeHtml(color)}44">${escapeHtml(avatarEmoji)}</div>
      <div class="msg-col">
        <div class="msg-header">
          <span class="msg-author-label" style="color:${escapeHtml(color)}">${escapeHtml(authorLabel)}</span>
          <span class="msg-time-label">connected</span>
        </div>
      </div>
    `;
    box.appendChild(row);
    cliActivityPendingRows.set(String(session.id), row);
    return row;
  }

  function resolveAnchorRow(session, identity, model) {
    const authorId = String(identity.authorId || session?.participant_agent_id || session?.id || "").trim();
    const messageRow = getLatestMessageRow(session?.thread_id, authorId, model?.anchor_message_id);
    if (messageRow) {
      const pendingRow = getPendingRow(session.id);
      if (pendingRow) {
        pendingRow.remove();
        cliActivityPendingRows.delete(String(session.id));
      }
      if (authorId && typeof cliActivityConfig.hideTyping === "function") {
        cliActivityConfig.hideTyping(authorId);
      }
      return messageRow;
    }
    const typingRow = authorId ? document.getElementById(`typing-${authorId}`) : null;
    if (typingRow) {
      return typingRow;
    }
    return ensurePendingRow(session, identity);
  }

  function attachCardToRow(row, cardEl) {
    if (!row || !cardEl) {
      return;
    }
    const col = row.querySelector(".msg-col");
    if (!col) {
      return;
    }
    const anchor = col.querySelector(".bubble-v2, .typing-bubble");
    if (cardEl.parentElement === col) {
      if (!anchor) {
        col.appendChild(cardEl);
      }
      return;
    }
    if (cardEl.parentElement) {
      cardEl.parentElement.removeChild(cardEl);
    }
    if (!anchor) {
      col.appendChild(cardEl);
      return;
    }
    const nextSibling = anchor.nextSibling;
    if (nextSibling) {
      col.insertBefore(cardEl, nextSibling);
    } else {
      col.appendChild(cardEl);
    }
  }

  function renderCliActivitySession(session, shouldAutoscroll = false) {
    const threadId = String(session?.thread_id || "").trim();
    const activeThreadId = typeof cliActivityConfig.getActiveThreadId === "function"
      ? String(cliActivityConfig.getActiveThreadId() || "").trim()
      : "";
    if (!threadId || !activeThreadId || threadId !== activeThreadId) {
      return;
    }

    const model = getNativeCardModel(session);
    if (!model) {
      return;
    }
    const actionState = getNativeCardAction(session);

    const identity = resolveActivityIdentity(session);
    const row = resolveAnchorRow(session, identity, model);
    if (!row) {
      return;
    }

    const cardEl = getNativeCard(session.id) || document.createElement("div");
    cardEl.className = "msg-native-card";
    cardEl.dataset.sessionId = String(session.id);
    cardEl.dataset.threadId = threadId;
    cardEl.dataset.authorId = String(identity.authorId || session?.participant_agent_id || session?.id || "").trim();
    cardEl.dataset.shellStatus = String(model.shell_status || "connected");
    cardEl.innerHTML = buildNativeCardHtml(model, actionState);
    attachCardToRow(row, cardEl);
    cliActivityCards.set(String(session.id), cardEl);

    if (shouldAutoscroll && typeof cliActivityConfig.scrollBottom === "function") {
      cliActivityConfig.scrollBottom(true);
    }
  }

  function syncThreadCliSessions(threadId, sessions) {
    const cache = getThreadActivityCache(threadId);
    if (!cache) {
      clearCliActivityRows();
      return;
    }
    cache.clear();
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      if (session?.id) {
        cache.set(String(session.id), session);
      }
    });
    clearCliActivityRows(threadId, false);
    for (const session of cache.values()) {
      renderCliActivitySession(session, false);
    }
  }

  function handleCliSessionEvent(event) {
    const payload = event?.payload || {};
    const type = String(event?.type || "");
    if (!type.startsWith("cli.session.") || type === "cli.session.output") {
      return;
    }
    if (type === "cli.session.removed") {
      const sessionId = String(payload?.session_id || payload?.session?.id || "").trim();
      const threadId = String(payload?.thread_id || payload?.session?.thread_id || "").trim();
      removeCliActivitySession(sessionId, threadId);
      return;
    }
    const session = payload?.session;
    if (!session || typeof session !== "object" || !session.id || !session.thread_id) {
      return;
    }
    const cache = getThreadActivityCache(session.thread_id);
    if (!cache) {
      return;
    }
    cache.set(String(session.id), session);
    renderCliActivitySession(session, type === "cli.session.activity" || type === "cli.session.native_card");
  }

  function refreshCliCardsForAuthor(authorId) {
    const targetAuthorId = String(authorId || "").trim();
    if (!targetAuthorId) {
      return;
    }
    const activeThreadId = typeof cliActivityConfig.getActiveThreadId === "function"
      ? String(cliActivityConfig.getActiveThreadId() || "").trim()
      : "";
    const cache = getThreadActivityCache(activeThreadId);
    if (!cache) {
      return;
    }
    for (const session of cache.values()) {
      const sessionAuthorId = String(session?.participant_agent_id || session?.id || "").trim();
      if (sessionAuthorId !== targetAuthorId) {
        continue;
      }
      renderCliActivitySession(session, false);
    }
  }

  function setActiveThreadAdminCache(admin) {
    try {
      window.__acbActiveThreadAdmin = admin && typeof admin === "object" ? { ...admin } : null;
    } catch {
      // Ignore cache write failures and keep UI functional.
    }
  }

  function setThreadAdminLabel(admin) {
    const adminEl = document.getElementById("thread-admin-label");
    if (!adminEl) return;
    const adminName = String(admin?.admin_name || "").trim();
    if (!adminName) {
      adminEl.hidden = true;
      adminEl.textContent = "";
      return;
    }
    const emoji = String(admin?.admin_emoji || "").trim() || "🤖";
    const adminType = String(admin?.admin_type || "").trim();
    const suffix = adminType === "creator"
      ? "创建者管理"
      : (adminType === "auto_assigned" ? "轮值管理" : "admin");
    adminEl.hidden = false;
    adminEl.textContent = `管理员: ${emoji} ${adminName} (${suffix})`;
  }

  async function refreshThreadAdmin(threadId, api) {
    if (!threadId) {
      setActiveThreadAdminCache(null);
      setThreadAdminLabel(null);
      return null;
    }
    try {
      const admin = await api(`/api/threads/${threadId}/admin`);
      setActiveThreadAdminCache(admin);
      setThreadAdminLabel(admin);
      return admin;
    } catch {
      setActiveThreadAdminCache(null);
      setThreadAdminLabel(null);
      return null;
    }
  }

  let _activeChatGeneration = 0;
  let _activeChatThreadId = null;

  function getMaxVisibleSeq(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((maxSeq, message) => {
      const seq = typeof message?.seq === "number" ? message.seq : Number(message?.seq);
      return Number.isFinite(seq) ? Math.max(maxSeq, seq) : maxSeq;
    }, 0);
  }

  async function fetchFullTranscript(id, api, checkActive) {
    let allMsgs = [];
    let afterSeq = 0;
    const pageSize = 200;
    while (true) {
      if (checkActive && !checkActive()) return null;
      const includePrompt = (afterSeq === 0) ? '1' : '0';
      const batch = (await api(`/api/threads/${id}/transcript?after_seq=${afterSeq}&limit=${pageSize}&include_system_prompt=${includePrompt}`)) || [];
      if (checkActive && !checkActive()) return null;
      if (!batch || !batch.length) break;
      allMsgs = allMsgs.concat(batch);
      const last = batch[batch.length - 1];
      const lastSeq = typeof last?.seq === 'number' ? last.seq : Number(last?.seq);
      if (Number.isFinite(lastSeq) && lastSeq > afterSeq) {
        afterSeq = lastSeq;
      } else {
        break;
      }
      if (batch.length < pageSize) break;
    }
    return allMsgs;
  }

  async function loadTranscript({
    id,
    api,
    clearThreadParticipants,
    rebuildActiveThreadParticipants,
    appendBubble,
    updateOnlinePresence,
    updateStatusBar,
    setLastSeq,
    scrollBottom,
    refreshAdmin = true,
    clearCliCache = true,
    messagesEl = null,
    sysPromptEl = null,
    skipCliActivity = false,
    generation = null,
  }) {
    const isMain = !messagesEl;
    if (isMain && _activeChatThreadId === null) {
      _activeChatThreadId = id;
    }
    const currentGen = isMain ? (typeof generation === 'number' ? generation : ++_activeChatGeneration) : null;
    if (isMain && typeof generation !== 'number') {
      _activeChatGeneration = currentGen;
      _activeChatThreadId = id;
    }
    const checkActive = isMain ? () => (_activeChatGeneration === currentGen && _activeChatThreadId === id) : null;

    if (checkActive && !checkActive()) return;

    const box = messagesEl || document.getElementById("messages");
    if (!box) {
      return;
    }

    if (checkActive && !checkActive()) return;
    box.classList.add("loading-history");

    try {
      const msgs = await fetchFullTranscript(id, api, checkActive);
      if (msgs === null || (checkActive && !checkActive())) {
        return;
      }

      setLastSeq(0);
      if (typeof clearThreadParticipants === "function") {
        clearThreadParticipants();
      }
      box.innerHTML = "";
      if (!skipCliActivity) {
        clearCliActivityRows(id, clearCliCache);
      }
      const sysPromptAreaEl = sysPromptEl || document.getElementById("sys-prompt-area");
      if (sysPromptAreaEl) {
        sysPromptAreaEl.innerHTML = "";
      }

      if (checkActive && !checkActive()) return;

      if (typeof rebuildActiveThreadParticipants === "function") {
        rebuildActiveThreadParticipants(msgs);
      }
      msgs.forEach(appendBubble);
      if (!skipCliActivity) {
        const cachedSessions = getThreadActivityCache(id);
        if (cachedSessions && !clearCliCache) {
          for (const session of cachedSessions.values()) {
            renderCliActivitySession(session, false);
          }
        }
      }
      if (typeof updateOnlinePresence === "function") {
        updateOnlinePresence();
      }
      if (typeof updateStatusBar === "function") {
        await updateStatusBar();
      }
      if (checkActive && !checkActive()) return;

      if (refreshAdmin) {
        await refreshThreadAdmin(id, api);
      }
      if (checkActive && !checkActive()) return;

      setLastSeq(getMaxVisibleSeq(msgs));
      if (window.AcbMessageRenderer?.renderMermaidBlocks) {
        await window.AcbMessageRenderer.renderMermaidBlocks(box);
      }
      if (checkActive && !checkActive()) return;

      if (typeof scrollBottom === "function") {
        scrollBottom(false);
      }
      refreshHumanDeliveryIndicators(id);
    } finally {
      if (!checkActive || checkActive()) {
        box.classList.remove("loading-history");
      }
    }
  }

  async function selectThread(options) {
    const id = options?.id;
    const topic = options?.topic;
    const status = options?.status;
    const initialSyncContext = options?.initialSyncContext;
    const setThreadSyncContext = options?.setThreadSyncContext;
    const setActiveThread = options?.setActiveThread;
    const generation = options?.generation;

    const currentGen = typeof generation === 'number' ? generation : ++_activeChatGeneration;
    _activeChatGeneration = currentGen;
    _activeChatThreadId = id;
    invalidateReceiptFetches();
    ensureComposeHint();

    if (typeof setActiveThread === 'function') {
      setActiveThread(id, status);
    }
    window.currentThreadId = id;  // Set global currentThreadId for modals
    if (setThreadSyncContext) {
      setThreadSyncContext(id, initialSyncContext || null);
    }

    document.querySelectorAll(".thread-item").forEach((el) => el.classList.remove("active"));
    const ti = document.getElementById(`ti-${id}`);
    if (ti) ti.classList.add("active");

    const header = document.getElementById("thread-header");
    if (header) header.style.display = "flex";
    const title = document.getElementById("thread-title");
    if (title) title.textContent = topic;
    const compose = document.getElementById("compose");
    if (compose) compose.classList.toggle("visible", status !== "archived");

    await loadTranscript({
      ...options,
      generation: currentGen,
      refreshAdmin: true,
      clearCliCache: true,
    });
  }

  async function loadNewMessagesForThread({
    threadId,
    getLastSeq,
    api,
    getAgentPresenceKey,
    getAgentDisplayName,
    recordThreadAgentActivity,
    appendBubble,
    updateOnlinePresence,
    updateStatusBar,
    setLastSeq,
    scrollBottom,
    messagesEl = null,
    skipPresence = false,
  }) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      return [];
    }

    const cursor = getLastSeq();
    const msgs =
      (await api(`/api/threads/${normalizedThreadId}/messages?after_seq=${cursor}&limit=100`)) || [];

    if (!skipPresence) {
      msgs.forEach((m) => {
        const key = getAgentPresenceKey(m);
        const label = getAgentDisplayName(m);
        if (key && typeof recordThreadAgentActivity === "function") {
          recordThreadAgentActivity(key, label, m.created_at);
        }
      });
    }

    msgs.forEach(appendBubble);
    if (typeof updateOnlinePresence === "function") {
      updateOnlinePresence();
    }
    if (typeof updateStatusBar === "function") {
      await updateStatusBar();
    }

    msgs.forEach((m) => {
      setLastSeq((prev) => Math.max(prev, m.seq));
    });

    const box = messagesEl || document.getElementById("messages");
    if (msgs.length && window.AcbMessageRenderer?.renderMermaidBlocks) {
      await window.AcbMessageRenderer.renderMermaidBlocks(box);
    }

    if (msgs.length && typeof scrollBottom === "function") {
      scrollBottom(true);
    }
    return msgs;
  }

  async function loadNewMessages({
    getActiveThreadId,
    getLastSeq,
    api,
    getAgentPresenceKey,
    getAgentDisplayName,
    recordThreadAgentActivity,
    appendBubble,
    updateOnlinePresence,
    updateStatusBar,
    setLastSeq,
    scrollBottom,
  }) {
    const activeThreadId = getActiveThreadId();
    if (!activeThreadId) return;

    const cursor = getLastSeq();
    const msgs =
      (await api(`/api/threads/${activeThreadId}/messages?after_seq=${cursor}&limit=100`)) || [];

    msgs.forEach((m) => {
      const key = getAgentPresenceKey(m);
      const label = getAgentDisplayName(m);
      if (key) recordThreadAgentActivity(key, label, m.created_at);
    });

    msgs.forEach(appendBubble);
    updateOnlinePresence();
    await updateStatusBar();

    msgs.forEach((m) => {
      setLastSeq((prev) => Math.max(prev, m.seq));
    });

    // Render any mermaid diagrams in new messages
    if (msgs.length && window.AcbMessageRenderer?.renderMermaidBlocks) {
      await window.AcbMessageRenderer.renderMermaidBlocks();
    }

    if (msgs.length) scrollBottom(true);
  }

  async function reloadTranscriptForThread({
    threadId,
    api,
    clearThreadParticipants,
    rebuildActiveThreadParticipants,
    appendBubble,
    updateOnlinePresence,
    updateStatusBar,
    setLastSeq,
    scrollBottom,
    messagesEl = null,
    sysPromptEl = null,
    skipCliActivity = false,
  }) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      return;
    }
    await loadTranscript({
      id: normalizedThreadId,
      api,
      clearThreadParticipants,
      rebuildActiveThreadParticipants,
      appendBubble,
      updateOnlinePresence,
      updateStatusBar,
      setLastSeq,
      scrollBottom,
      refreshAdmin: false,
      clearCliCache: false,
      messagesEl,
      sysPromptEl,
      skipCliActivity,
    });
  }

  async function reloadTranscript({
    getActiveThreadId,
    api,
    clearThreadParticipants,
    rebuildActiveThreadParticipants,
    appendBubble,
    updateOnlinePresence,
    updateStatusBar,
    setLastSeq,
    scrollBottom,
  }) {
    const activeThreadId = getActiveThreadId();
    if (!activeThreadId) {
      return;
    }
    await loadTranscript({
      id: activeThreadId,
      api,
      clearThreadParticipants,
      rebuildActiveThreadParticipants,
      appendBubble,
      updateOnlinePresence,
      updateStatusBar,
      setLastSeq,
      scrollBottom,
      refreshAdmin: false,
      clearCliCache: false,
    });
  }

  let _isSendingMessage = false;
  let _sendGeneration = 0;

  async function sendMessage({
    getActiveThreadId,
    getLastSeq,
    getThreadSyncContext,
    setThreadSyncContext,
    updateOnlinePresence,
    autoResize,
    api,
    setLastSeq,
    appendBubble,
    scrollBottom,
  }) {
    if (_isSendingMessage) return;

    const activeThreadId = getActiveThreadId();
    const input = document.getElementById("compose-input");
    if (!input || !activeThreadId) return;
    const author = document.getElementById("compose-author")?.value?.trim() || "human";
    const acb = document.querySelector("acb-compose-shell");
    const sendGen = ++_sendGeneration;
    const isTargetStillValid = () => getActiveThreadId() === activeThreadId && sendGen === _sendGeneration;

    // Extract content and mentions with full recursion for nested structures
    const mentions = [];
    const mentionLabels = {};
    function extractRichContent(root) {
      if (!root) return "";
      let text = "";
      const nodes = root.childNodes || [];
      for (const node of nodes) {
        if (node.nodeType === 3) {
          text += node.textContent || "";
        } else if (node.nodeType === 1) {
          // If it's a mention pill
          if (typeof node.hasAttribute === "function" && node.hasAttribute("data-mention-id")) {
            const mid = node.getAttribute("data-mention-id");
            const mlabel = node.getAttribute("data-mention-label") || (node.textContent || "").replace(/^@/, "");
            if (!mentions.includes(mid)) {
              mentions.push(mid);
              mentionLabels[mid] = mlabel;
            }
            text += node.textContent || "";
          } else {
            const innerText = extractRichContent(node);
            text += innerText;
            if (node.tagName === "DIV" || node.tagName === "P" || node.tagName === "BR") {
              if (text && !text.endsWith("\n")) text += "\n";
            }
          }
        }
      }
      return text;
    }

    const content = extractRichContent(input).trim();
    const initialInputHtml = input._innerHTML != null ? input._innerHTML : input.innerHTML;
    const initialInputText = content;
    const images = (acb && Array.isArray(acb.uploadedImages)) ? [...acb.uploadedImages] : [];

    if (!content && images.length === 0) return;

    _isSendingMessage = true;
    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = true;

    try {
      updateOnlinePresence();

      const payload = {
        author,
        role: "user",
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        metadata: mentions.length > 0 ? { mention_labels: mentionLabels } : undefined,
        images: images.length > 0 ? images : undefined,
      };

      const loadFreshSyncContext = async () => {
        return await api(`/api/threads/${activeThreadId}/sync-context`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      };

      const isValidSyncContext = (sync) =>
        sync && typeof sync.current_seq === "number" && typeof sync.reply_token === "string" && sync.reply_token;

      const isValidMessageResponse = (message) =>
        message && typeof message.id === "string" && typeof message.seq === "number" && typeof message.content === "string";

      let sync = getThreadSyncContext ? getThreadSyncContext(activeThreadId) : null;
      const knownLastSeq = typeof getLastSeq === "function" ? Number(getLastSeq()) || 0 : 0;
      if (isValidSyncContext(sync) && Number(sync.current_seq) < knownLastSeq) {
        sync = null;
      }
      if (!isValidSyncContext(sync)) {
        sync = await loadFreshSyncContext();
      }
      if (!isTargetStillValid()) return;
      if (!isValidSyncContext(sync)) {
        console.warn("[Chat] Unable to obtain sync context for human message; draft retained.");
        return;
      }

      let response = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        payload.expected_last_seq = sync.current_seq;
        payload.reply_token = sync.reply_token;

        response = await api(`/api/threads/${activeThreadId}/messages`, {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (!isTargetStillValid()) return;

        if (isValidMessageResponse(response)) {
          break;
        }

        if (response?.error === "SEQ_MISMATCH" && attempt === 0) {
          sync = await loadFreshSyncContext();
          if (!isTargetStillValid()) return;
          if (!isValidSyncContext(sync)) {
            console.warn("[Chat] Unable to refresh sync context after SEQ_MISMATCH; draft retained.");
            return;
          }
          continue;
        }

        console.warn("[Chat] Message send failed; draft retained:", response);
        return;
      }

      if (isValidMessageResponse(response) && isTargetStillValid()) {
        // Clear draft ONLY on verified send success, same thread & generation, and user hasn't edited
        const currentInputHtml = input._innerHTML != null ? input._innerHTML : input.innerHTML;
        const currentInputText = extractRichContent(input).trim();
        const isDraftUnedited = (currentInputHtml === initialInputHtml) || (currentInputText === initialInputText);

        if (isDraftUnedited) {
          input.innerHTML = "";
          if (Array.isArray(input.childNodes)) input.childNodes = [];
          const messageBar = document.getElementById("mentions-bar");
          if (messageBar) messageBar.style.display = "none";
          if (acb && Array.isArray(acb.uploadedImages)) acb.uploadedImages = [];
          if (acb && typeof acb.renderImagePreview === "function") acb.renderImagePreview();
          if (typeof autoResize === "function") autoResize();
        } else {
          // User edited during flight: preserve new edits; filter out only the sent images
          if (acb && Array.isArray(acb.uploadedImages)) {
            acb.uploadedImages = acb.uploadedImages.filter(img =>
              !images.includes(img) && !images.some(sent => sent && sent.id && sent.id === img?.id)
            );
            if (typeof acb.renderImagePreview === "function") acb.renderImagePreview();
          }
        }

        if (setThreadSyncContext) {
          setThreadSyncContext(activeThreadId, null);
        }
        setLastSeq((prev) => Math.max(prev, response.seq));
        appendBubble(response);
        scrollBottom(true);
      }
    } catch (err) {
      console.error("[Chat] Error sending message; draft retained:", err);
    } finally {
      _isSendingMessage = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }
    function handleKey(e, sendMessageFn) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessageFn();
    }
  }

  // ==========================================================================
  // Task Receipts & Directed Message Presentation Engine (Refined)
  // ==========================================================================
  let _receiptFetchGeneration = 0;
  const _receiptThread404Cache = new Set();
  let _receiptCoalesceScheduled = false;
  let _pendingReceiptResolvers = [];
  let _pendingReceiptThreadId = null;
  let _pendingReceiptCustomFetch = null;
  let _customAgentResolver = null;
  let _receiptActiveJob = null;

  function invalidateReceiptFetches() {
    _receiptFetchGeneration++;
    _receiptActiveJob = null;
    _pendingReceiptResolvers.forEach((r) => {
      try { r(); } catch {}
    });
    _pendingReceiptResolvers = [];
    _pendingReceiptThreadId = null;
    _pendingReceiptCustomFetch = null;
  }

  function setAgentResolver(resolver) {
    if (typeof resolver === "function") {
      _customAgentResolver = resolver;
    }
  }

  function ensureTaskReceiptsCss() {
    if (typeof document === "undefined" || !document.head) return;
    if (document.getElementById("task-receipts-css") || document.querySelector('link[href*="task-receipts.css"]')) {
      return;
    }
    try {
      const link = document.createElement("link");
      link.id = "task-receipts-css";
      link.rel = "stylesheet";
      link.href = "/static/css/task-receipts.css?v=1";
      document.head.appendChild(link);
    } catch {}
  }

  function ensureComposeHint() {
    if (typeof document === "undefined") return;
    try {
      const composeWrap = document.getElementById("compose") || (document.querySelector && document.querySelector("acb-compose-shell"));
      if (!composeWrap) return;

      let hintEl = document.getElementById("compose-task-hint");
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.id = "compose-task-hint";
        hintEl.className = "compose-task-hint";
        hintEl.innerHTML = `
          <span class="cth-icon" aria-hidden="true">💡</span>
          <span class="cth-text cth-text-full">要指定任务请用 @ 选择身份，直接写昵称不会分配任务</span>
          <span class="cth-text cth-text-short">@ 选择智能体分配任务</span>
          <span id="compose-web-agent-warning" class="cth-web-warning" style="display:none;"> · ⚠️ 选择网页 agent 需要其主动查看</span>
        `;
        hintEl.title = '使用 @ 选择真实身份；直接输入昵称不会分配任务。网页智能体需主动查看。';

        const inputEl = document.getElementById("compose-input");
        if (inputEl && inputEl.parentNode) {
          inputEl.parentNode.insertBefore(hintEl, inputEl);
        } else {
          composeWrap.appendChild(hintEl);
        }
      }

      const inputEl = document.getElementById("compose-input");
      if (inputEl && !inputEl._hasReceiptMentionListener) {
        inputEl._hasReceiptMentionListener = true;
        inputEl.addEventListener("input", syncComposeWebAgentWarning);
        if (typeof MutationObserver === "function") {
          const observer = new MutationObserver(syncComposeWebAgentWarning);
          observer.observe(inputEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-mention-id"] });
          inputEl._receiptMentionObserver = observer;
        }
      }
      syncComposeWebAgentWarning();
    } catch {}
  }

  function findMentionsRecursively(node, result = []) {
    if (!node) return result;
    if (node.nodeType === 1) {
      if (typeof node.getAttribute === "function" && node.getAttribute("data-mention-id")) {
        result.push(String(node.getAttribute("data-mention-id") || "").trim());
      }
      for (const child of node.childNodes || []) {
        findMentionsRecursively(child, result);
      }
    }
    return result;
  }

  function syncComposeWebAgentWarning() {
    if (typeof document === "undefined") return;
    try {
      const warningEl = document.getElementById("compose-web-agent-warning");
      if (!warningEl) return;
      const inputEl = document.getElementById("compose-input");
      if (!inputEl) return;

      const mentionIds = findMentionsRecursively(inputEl);
      let hasWebMention = false;

      for (const mid of mentionIds) {
        const targetInfo = getReceiptTargetInfo(mid);
        if (targetInfo && targetInfo.isWebSession) {
          hasWebMention = true;
          break;
        }
      }

      warningEl.style.display = hasWebMention ? "inline" : "none";
    } catch {}
  }

  function getReceiptTargetInfo(targetAgentId) {
    const rawId = String(targetAgentId || "").trim();

    if (typeof window !== "undefined" && window.AcbAvatarSystem) {
      try {
        const resolved = window.AcbAvatarSystem.resolveAgentAvatar(rawId);
        if (resolved && resolved.canonicalAgentId) {
          return {
            name: String(resolved.displayName || rawId).trim(),
            emoji: String(resolved.emoji || "🤖").trim(),
            isWebSession: Boolean(resolved.isWebSession),
          };
        }
      } catch {}
    }

    // 1. Custom agent resolver if configured by host/index
    if (typeof _customAgentResolver === "function") {
      try {
        const custom = _customAgentResolver(rawId);
        if (custom) {
          const isWeb = Boolean(
            custom.isWebSession ||
            custom.is_web_session ||
            custom.connection_type === "browser" ||
            custom.capabilities?.includes("browser-ui") ||
            custom.capabilities?.includes("web-session-presence") ||
            String(custom.model || "").toLowerCase().includes("web session") ||
            custom.last_activity === "browser_heartbeat"
          );
          return {
            name: String(custom.display_name || custom.name || rawId).trim(),
            emoji: String(custom.emoji || (isWeb ? "🍍" : "🤖")).trim(),
            isWebSession: isWeb,
          };
        }
      } catch {}
    }

    // 2. Global agents cache
    const globalAgents = (typeof window !== "undefined" && (window.__acbCurrentAgents || window.currentAgents)) || [];
    const matched = globalAgents.find((a) => String(a.id || a.agent_id || "").trim() === rawId);
    if (matched) {
      const isWeb = Boolean(
        matched.isWebSession ||
        matched.is_web_session ||
        matched.connection_type === "browser" ||
        matched.capabilities?.includes("browser-ui") ||
        matched.capabilities?.includes("web-session-presence") ||
        String(matched.model || "").toLowerCase().includes("web session") ||
        matched.last_activity === "browser_heartbeat"
      );
      return {
        name: String(matched.display_name || matched.name || rawId).trim(),
        emoji: String(matched.emoji || (isWeb ? "🍍" : "🤖")).trim(),
        isWebSession: isWeb,
      };
    }

    // 3. Fallback: discover from DOM status items
    if (typeof document !== "undefined" && typeof document.querySelector === "function") {
      try {
        const statusItem = document.querySelector(`acb-agent-status-item[data-agent-id="${rawId}"], [data-agent-id="${rawId}"]`);
        if (statusItem) {
          const label = statusItem.getAttribute("data-agent-label") || statusItem.dataset?.agentLabel;
          const emojiEl = statusItem.querySelector ? statusItem.querySelector(".asi-avatar, .acb-seat-avatar span") : null;
          const emoji = emojiEl ? emojiEl.textContent.trim() : "🤖";
          const isWeb = statusItem.getAttribute("data-session-type") === "browser" || statusItem.dataset?.sessionType === "browser";
          if (label) {
            return { name: label, emoji: emoji || "🤖", isWebSession: isWeb };
          }
        }
      } catch {}
    }

    const shortId = rawId.length > 12 ? rawId.slice(0, 8) + "…" : rawId;
    return { name: shortId || "Agent", emoji: "🤖", isWebSession: false };
  }

  const RECEIPT_STATUS_MAP = {
    awaiting_ack: {
      label: "待确认",
      className: "mtr-status-badge--awaiting_ack",
      desc: "等待 agent 主动查看，尚未自动投递",
    },
    acknowledged: {
      label: "已接单",
      className: "mtr-status-badge--acknowledged",
      desc: "agent 已确认接收该任务，准备执行",
    },
    running: {
      label: "执行中",
      className: "mtr-status-badge--running",
      desc: "agent 正在执行任务",
    },
    completed: {
      label: "完成",
      className: "mtr-status-badge--completed",
      desc: "任务已执行完毕",
    },
    failed: {
      label: "失败",
      className: "mtr-status-badge--failed",
      desc: "任务执行失败或发生错误",
    },
    unavailable: {
      label: "回执暂不可用",
      className: "mtr-status-badge--unavailable",
      desc: "服务暂未同步此定向任务状态",
    },
  };

  function renderReceiptItemHtml(receipt, fallbackTargetId = "") {
    const statusKey = String(receipt?.status || "unavailable").toLowerCase();
    const statusMeta = RECEIPT_STATUS_MAP[statusKey] || RECEIPT_STATUS_MAP.unavailable;
    const targetId = String(receipt?.target_agent_id || fallbackTargetId || "").trim();
    const targetInfo = getReceiptTargetInfo(targetId);
    const isBrowser = receipt?.connection_type === "browser" || targetInfo.isWebSession;

    const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);

    return `
      <div class="msg-task-receipt" data-status="${esc(statusKey)}" data-target-id="${esc(targetId)}">
        <div class="mtr-header">
          <span class="mtr-target-icon">${esc(targetInfo.emoji)}</span>
          <span class="mtr-target-name">${esc(targetInfo.name)}</span>
          <span class="mtr-status-badge ${esc(statusMeta.className)}">${esc(statusMeta.label)}</span>
        </div>
        <div class="mtr-desc">${esc(statusMeta.desc)}</div>
        ${isBrowser ? '<div class="mtr-browser-warning">网页在线不表示模型执行</div>' : ""}
      </div>
    `;
  }

  function renderRowReceipts(row, receipts, fallbackNotice = "") {
    if (!row) return;
    if (row.isConnected !== undefined && row.isConnected === false) return;

    try {
      const targetCol = (row.querySelector && row.querySelector(".msg-col")) || row;
      let container = targetCol.querySelector ? targetCol.querySelector(".msg-task-receipts") : null;

      if (!receipts || receipts.length === 0) {
        if (fallbackNotice) {
          if (!container && typeof document !== "undefined" && typeof document.createElement === "function") {
            container = document.createElement("div");
            container.className = "msg-task-receipts";
            targetCol.appendChild(container);
          }
          if (container) {
            container.innerHTML = `
              <div class="msg-task-receipt" data-status="unavailable">
                <div class="mtr-header">
                  <span class="mtr-status-badge mtr-status-badge--unavailable">回执暂不可用</span>
                </div>
                <div class="mtr-desc">${fallbackNotice}</div>
              </div>
            `;
          }
        } else if (container && typeof container.remove === "function") {
          container.remove();
        }
        return;
      }

      if (!container && typeof document !== "undefined" && typeof document.createElement === "function") {
        container = document.createElement("div");
        container.className = "msg-task-receipts";
        targetCol.appendChild(container);
      }

      if (container) {
        container.innerHTML = receipts.map((r) => renderReceiptItemHtml(r)).join("");
      }
    } catch {}
  }

  async function _executeReceiptsFetch(activeId, fetchFn) {
    if (!activeId || !fetchFn) return;

    const generation = ++_receiptFetchGeneration;

    // Clean legacy elements if any
    if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
      document.querySelectorAll("#messages .msg-human-delivery").forEach((el) => {
        if (typeof el.remove === "function") el.remove();
      });
    }

    const allRows = typeof document !== "undefined" && typeof document.querySelectorAll === "function"
      ? Array.from(document.querySelectorAll("#messages .msg-row"))
      : [];

    const directedRows = allRows.filter((row) => {
      if (row.classList && typeof row.classList.contains === "function" && row.classList.contains("message-has-mentions")) return true;
      if (row.querySelector && (row.querySelector("[data-mention-id]") || row.querySelector(".mention-chip"))) return true;
      return false;
    });

    if (directedRows.length === 0) {
      return;
    }

    // Determine min and max seq of visible loaded rows to avoid scanning outside bounds
    let minSeq = Infinity;
    let maxSeq = 0;
    directedRows.forEach((r) => {
      const seqAttr = r.getAttribute ? r.getAttribute("data-seq") : r.dataset?.seq;
      const seq = seqAttr != null ? parseInt(seqAttr, 10) : NaN;
      if (!isNaN(seq) && Number.isFinite(seq)) {
        if (seq < minSeq) minSeq = seq;
        if (seq > maxSeq) maxSeq = seq;
      }
    });

    const startAfterSeq = Math.max(0, isFinite(minSeq) ? minSeq - 1 : 0);
    const targetMaxSeq = isFinite(maxSeq) ? maxSeq : Infinity;

    if (_receiptThread404Cache.has(activeId)) {
      directedRows.forEach((r) => renderRowReceipts(r, null, "服务暂未同步此定向任务状态"));
      return;
    }

    const isStale = () => {
      if (generation !== _receiptFetchGeneration) return true;
      if (typeof window !== "undefined" && window.currentThreadId && window.currentThreadId !== activeId) return true;
      return false;
    };

    let cursor = startAfterSeq;
    const allReceipts = [];
    const MAX_PAGES = 10;
    let pageCount = 0;

    while (pageCount++ < MAX_PAGES) {
      if (isStale()) return;

      const url = `/api/threads/${encodeURIComponent(activeId)}/task-receipts?after_seq=${cursor}&limit=200`;
      let res;
      try {
        res = await fetchFn(url);
      } catch (err) {
        if (isStale()) return;
        directedRows.forEach((r) => renderRowReceipts(r, null, "回执暂不可用（网络连接异常）"));
        return;
      }

      if (isStale()) return;

      if (res && res.status === 404) {
        _receiptThread404Cache.add(activeId);
        directedRows.forEach((r) => renderRowReceipts(r, null, "服务暂未同步此定向任务状态"));
        return;
      }

      if (!res || !res.ok) {
        directedRows.forEach((r) => renderRowReceipts(r, null, "回执暂不可用"));
        return;
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        if (isStale()) return;
        directedRows.forEach((r) => renderRowReceipts(r, null, "回执数据解析异常"));
        return;
      }

      if (isStale()) return;

      const pageReceipts = Array.isArray(data?.receipts) ? data.receipts : [];
      allReceipts.push(...pageReceipts);

      const hasMore = Boolean(data?.has_more);
      const nextSeq = typeof data?.next_seq === "number" ? data.next_seq : null;

      if (!hasMore || nextSeq === null || nextSeq <= cursor || nextSeq > targetMaxSeq) {
        break;
      }

      cursor = nextSeq;
    }

    if (isStale()) return;

    const receiptsByMsgId = new Map();
    const receiptsBySeq = new Map();

    allReceipts.forEach((r) => {
      if (r.message_id) {
        const mid = String(r.message_id).trim();
        if (!receiptsByMsgId.has(mid)) receiptsByMsgId.set(mid, []);
        receiptsByMsgId.get(mid).push(r);
      }
      if (typeof r.message_seq === "number") {
        const seq = r.message_seq;
        if (!receiptsBySeq.has(seq)) receiptsBySeq.set(seq, []);
        receiptsBySeq.get(seq).push(r);
      }
    });

    directedRows.forEach((row) => {
      const msgId = String(row.getAttribute ? (row.getAttribute("data-msg-id") || "") : "").trim();
      const seqAttr = row.getAttribute ? row.getAttribute("data-seq") : null;
      const seq = seqAttr != null ? parseInt(seqAttr, 10) : NaN;

      const matchingReceipts = (msgId && receiptsByMsgId.get(msgId)) || (!isNaN(seq) && receiptsBySeq.get(seq)) || [];

      if (matchingReceipts.length > 0) {
        renderRowReceipts(row, matchingReceipts);
      } else {
        renderRowReceipts(row, null, "回执暂不可用");
      }
    });
  }

  function scheduleReceiptDrain() {
    if (_receiptCoalesceScheduled || _receiptActiveJob) return;
    _receiptCoalesceScheduled = true;
    const scheduleFn = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => setTimeout(fn, 0);
    scheduleFn(async () => {
      _receiptCoalesceScheduled = false;
      const targetThread = _pendingReceiptThreadId;
      if (!targetThread) return;
      const resolvers = _pendingReceiptResolvers.splice(0);
      const targetFetch = _pendingReceiptCustomFetch || (typeof fetch === "function" ? fetch : null);
      _pendingReceiptThreadId = null;
      _pendingReceiptCustomFetch = null;
      const job = {};
      _receiptActiveJob = job;
      try {
        await _executeReceiptsFetch(targetThread, targetFetch);
      } finally {
        resolvers.forEach(r => { try { r(); } catch {} });
        if (_receiptActiveJob === job) {
          _receiptActiveJob = null;
          if (_pendingReceiptThreadId) scheduleReceiptDrain();
        }
      }
    });
  }

  function refreshHumanDeliveryIndicators(threadId, customFetch = null) {
    ensureTaskReceiptsCss();
    ensureComposeHint();

    const activeId = String(threadId || (typeof window !== "undefined" ? window.currentThreadId : "") || "").trim();
    if (!activeId) return Promise.resolve();

    _pendingReceiptThreadId = activeId;
    if (customFetch) _pendingReceiptCustomFetch = customFetch;

    return new Promise((resolve) => {
      _pendingReceiptResolvers.push(resolve);

      scheduleReceiptDrain();
    });
  }

  window.AcbChat = {
    configureCliActivity: setCliActivityConfig,
    handleCliSessionEvent,
    syncThreadCliSessions,
    clearCliActivityForAuthor,
    refreshCliCardsForAuthor,
    clearCliActivityRows,
    refreshThreadAdmin,
    selectThread,
    reloadTranscript,
    loadTranscript,
    loadNewMessagesForThread,
    reloadTranscriptForThread,
    loadNewMessages,
    sendMessage,
    handleKey,
    refreshHumanDeliveryIndicators,
    setAgentResolver,
    invalidateReceiptFetches,
  };

  if (typeof window !== "undefined") {
    window.addEventListener("acb-avatar-bindings-changed", () => {
      document.querySelectorAll(".msg-task-receipt").forEach((el) => {
        const targetId = el.getAttribute("data-target-id");
        if (targetId) {
          const info = getReceiptTargetInfo(targetId);
          const iconEl = el.querySelector(".mtr-target-icon");
          const nameEl = el.querySelector(".mtr-target-name");
          if (iconEl) iconEl.textContent = info.emoji;
          if (nameEl) nameEl.textContent = info.name;
        }
      });
    });
  }
})();
