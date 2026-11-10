/**
 * AgentChatBus Browser Agent Interface (js/browser-agent.js)
 * High-Density SaaS Client for Browser-Only Agents (e.g. Muse / Marley)
 *
 * Adheres strictly to Codex API Contract:
 *  - GET  /api/threads
 *  - POST /api/browser-agents/join
 *  - GET  /api/browser-agents/session
 *  - POST /api/browser-agents/heartbeat
 *  - POST /api/browser-agents/leave
 *  - POST /api/browser-agents/threads/:id/sync-context
 *  - POST /api/browser-agents/threads/:id/messages
 *  - GET  /api/threads/:id/transcript?after_seq=N&limit=200&include_system_prompt=0
 *
 * Security & Reliability:
 *  - Tokens stored exclusively in sessionStorage; never logged or exposed in UI
 *  - Double-click prevention & draft preservation on network/seq failure
 *  - Generation guards for async thread switches & message posts
 *  - Pure safe DOM construction & strict HTML escaping
 *  - Visibilitychange-aware 20s heartbeat & keepalive leave
 *  - Resilient clipboard copy with fallback
 */

(() => {
  'use strict';

  // Session storage: v2 stores only non-sensitive display state; auth uses
  // HttpOnly same-browser cookie. Legacy v1 token entries are migrated once.
  const STORAGE_KEY = 'acb_browser_agent_session_v2';
  const LEGACY_STORAGE_KEY = 'acb_browser_agent_session_v1';
  const DEFAULT_HEARTBEAT_INTERVAL_MS = 20000;
  const TRANSCRIPT_PAGE_SIZE = 200;
  const POLL_INTERVAL_MS = 3500;

  // Runtime State
  let session = null; // { agent_id, display_name, provider, thread_id, heartbeat_interval_ms, lease_id }
  let migrationHeaders = null; // one-time legacy header creds for cookie migration
  let activeThreadId = null;
  let activeThreadGeneration = 0;
  let lifecycleGeneration = 0;
  let currentLastSeq = 0;
  let isSending = false;
  let isLeavingManually = false;

  let heartbeatTimer = null;
  let pollTimer = null;
  let hasUserScrolledUp = false;
  let pendingJoinConflict = null;

  // DOM Elements Cache
  const els = {};

  function initElements() {
    els.app = document.getElementById('ba-app');
    els.statusDot = document.getElementById('ba-status-dot');
    els.identityPill = document.getElementById('ba-identity-pill');
    els.identityAvatar = document.getElementById('ba-identity-avatar');
    els.identityName = document.getElementById('ba-identity-name');
    els.identityTag = document.getElementById('ba-identity-tag');

    els.leaveBtn = document.getElementById('ba-leave-btn');
    els.moreMenuBtn = document.getElementById('ba-more-menu-btn');
    els.moreDropdown = document.getElementById('ba-more-dropdown');
    els.switchThreadBtn = document.getElementById('ba-switch-thread-btn');
    els.resetSessionBtn = document.getElementById('ba-reset-session-btn');

    els.setupOverlay = document.getElementById('ba-setup-overlay');
    els.setupForm = document.getElementById('ba-setup-form');
    els.inputDisplayName = document.getElementById('ba-input-name');
    els.inputProvider = document.getElementById('ba-input-provider');
    els.selectThread = document.getElementById('ba-select-thread');
    els.joinSubmitBtn = document.getElementById('ba-join-submit-btn');
    els.setupAlert = document.getElementById('ba-setup-alert');
    els.identityConflict = document.getElementById('ba-identity-conflict');
    els.identityConflictText = document.getElementById('ba-identity-conflict-text');
    els.conflictRecoverBtn = document.getElementById('ba-conflict-recover-btn');
    els.conflictCreateBtn = document.getElementById('ba-conflict-create-btn');
    els.conflictCancelBtn = document.getElementById('ba-conflict-cancel-btn');

    els.workspace = document.getElementById('ba-workspace');
    els.threadTitle = document.getElementById('ba-thread-title');
    els.threadIdPill = document.getElementById('ba-thread-id-pill');
    els.threadSeqPill = document.getElementById('ba-thread-seq-pill');
    els.refreshThreadBtn = document.getElementById('ba-refresh-thread-btn');

    els.transcript = document.getElementById('ba-transcript');
    els.scrollBottomBtn = document.getElementById('ba-scroll-bottom-btn');

    els.errorBanner = document.getElementById('ba-error-banner');
    els.errorText = document.getElementById('ba-error-text');
    els.errorRetryBtn = document.getElementById('ba-error-retry-btn');
    els.errorDismissBtn = document.getElementById('ba-error-dismiss-btn');

    els.composeTextarea = document.getElementById('ba-textarea');
    els.sendBtn = document.getElementById('ba-send-btn');
    els.composerAuthorName = document.getElementById('ba-composer-author-name');
  }

  // ==================================================================================
  // Session Persistence (Strictly sessionStorage, never localStorage or URL)
  // ==================================================================================

  function ensureLeaseId() {
    if (session && session.lease_id) return session.lease_id;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('lease-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    if (session) session.lease_id = id;
    return id;
  }

  function sanitizeSession(data) {
    if (!data || typeof data.agent_id !== 'string') return null;
    const { token, ..._safe } = data || {};
    return {
      agent_id: data.agent_id,
      display_name: data.display_name || 'Browser Agent',
      provider: data.provider || 'Browser',
      thread_id: data.thread_id || null,
      heartbeat_interval_ms: data.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS,
      lease_id: data.lease_id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('lease-' + Date.now())),
    };
  }

  function loadStoredSession() {
    try {
      const rawV2 = sessionStorage.getItem(STORAGE_KEY);
      if (rawV2) {
        const parsed = JSON.parse(rawV2);
        if (parsed && typeof parsed.agent_id === 'string') return sanitizeSession(parsed);
      }
      const rawV1 = sessionStorage.getItem(LEGACY_STORAGE_KEY);
      if (rawV1) {
        const legacy = JSON.parse(rawV1);
        if (legacy && typeof legacy.agent_id === 'string' && typeof legacy.token === 'string') {
          migrationHeaders = { 'X-Agent-Id': legacy.agent_id, 'X-Agent-Token': legacy.token, 'X-Browser-Migrate-Cookie': '1' };
          // Retain legacy proof until the server has accepted the migration.
          return sanitizeSession(legacy);
        }
        try { sessionStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
      }
    } catch (e) {
      console.warn('[Session] Failed to parse stored session:', e);
    }
    return null;
  }

  function saveSession(data) {
    session = sanitizeSession({ ...(session || {}), ...(data || {}) });
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      console.error('[Session] Failed to write sessionStorage:', e);
    }
  }

  function clearSession() {
    session = null;
    migrationHeaders = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) {}
  }

  async function browserApi(path, options = {}) {
    const callingAgentId = session ? session.agent_id : null;
    const opts = { ...options };
    const headers = {
      Accept: 'application/json',
      ...(opts.headers || {}),
    };
    if (opts.body && typeof opts.body === 'object' && !(typeof FormData !== 'undefined' && opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    if (migrationHeaders && path.startsWith('/api/browser-agents/')) {
      Object.assign(headers, migrationHeaders);
    }
    opts.headers = headers;
    opts.credentials = opts.credentials || 'same-origin';
    const response = await fetch(path, opts);
    if (migrationHeaders && response.ok && path.startsWith('/api/browser-agents/session')) {
      migrationHeaders = null;
    }
    if (response.status === 401 && path.startsWith('/api/browser-agents/')) {
      if (session && session.agent_id === callingAgentId) {
        handleUnauthorizedSession();
      }
      throw new Error('UNAUTHORIZED_SESSION');
    }
    return response;
  }

  function handleUnauthorizedSession() {
    clearSession();
    stopHeartbeat();
    stopPolling();
    updateStatus('offline', '已离线');
    showSetupOverlay('已离线');
  }


  // ==================================================================================
  // Thread Management & Selection
  // ==================================================================================

  async function loadThreadsList() {
    try {
      const res = await fetch('/api/threads?include_archived=1');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const threads = Array.isArray(data) ? data : (data && Array.isArray(data.threads) ? data.threads : []);

      els.selectThread.innerHTML = '';
      if (threads.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '暂无开放讨论 (请在控制台创建讨论)';
        els.selectThread.appendChild(opt);
        return threads;
      }

      // Check URL search param
      const urlParams = new URLSearchParams(window.location.search);
      const urlThreadId = urlParams.get('thread_id');

      threads.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        const topic = t.topic || '未命名讨论';
        const isArchived = t.status === 'archived' ? ' [已归档]' : '';
        opt.textContent = `${topic} (${t.id.slice(0, 8)})${isArchived}`;
        if (urlThreadId && urlThreadId === t.id) {
          opt.selected = true;
        } else if (!urlThreadId && session && session.thread_id === t.id) {
          opt.selected = true;
        }
        els.selectThread.appendChild(opt);
      });

      return threads;
    } catch (err) {
      console.error('[Threads] Failed to load threads:', err);
      els.selectThread.innerHTML = '<option value="">加载讨论失败</option>';
      return [];
    }
  }

  // ==================================================================================
  // Session Join & Lifecycle Operations
  // ==================================================================================

  function showJoinConflict(message, payload) {
    pendingJoinConflict = payload || null;
    if (els.identityConflictText) els.identityConflictText.textContent = message || '检测到同名网页身份，请选择恢复原会话或明确创建新身份。';
    if (els.identityConflict) els.identityConflict.style.display = 'block';
    hideSetupAlert();
  }
  function hideJoinConflict() {
    pendingJoinConflict = null;
    if (els.identityConflict) els.identityConflict.style.display = 'none';
  }

  async function withIdentityJoinLock(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('acb-browser-identity-join-v2', { mode: 'exclusive' }, fn);
    }
    return fn();
  }

  async function recoverBrowserSessionBeforeCreate() {
    try {
      const res = await fetch('/api/browser-agents/session', { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json', ...(migrationHeaders || {}) } });
      if (res.ok) {
        const body = await res.json();
        if (body && body.agent && body.agent.id) {
          saveSession({ agent_id: body.agent.id, display_name: body.agent.display_name || session?.display_name, provider: session?.provider || 'Browser', thread_id: session?.thread_id || null, heartbeat_interval_ms: body.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS });
          migrationHeaders = null;
          return body;
        }
      }
    } catch {}
    return null;
  }

  async function performJoinRequest(payload) {
    return browserApi('/api/browser-agents/join', { method: 'POST', body: payload });
  }

  async function handleJoinSubmit(e, opts = {}) {
    if (e) e.preventDefault();
    hideJoinConflict();
    const displayName = (els.inputDisplayName.value || '').trim();
    const provider = (els.inputProvider.value || '').trim() || 'Browser Agent';
    const targetThreadId = els.selectThread.value;
    if (!displayName) { showSetupAlert('请输入代理显示昵称'); els.inputDisplayName.focus(); return; }
    if (!targetThreadId) { showSetupAlert('请选择目标讨论'); return; }
    hideSetupAlert();
    els.joinSubmitBtn.disabled = true;
    els.joinSubmitBtn.textContent = '正在加入…';
    try {
      await withIdentityJoinLock(async () => {
        // Recover before create in same browser context.
        if (!opts.create_new) {
          const recovered = await recoverBrowserSessionBeforeCreate();
          if (recovered && recovered.agent && recovered.agent.id) {
            // If recovered, just switch/join target thread with existing identity.
            const j = await performJoinRequest({ thread_id: targetThreadId, display_name: displayName });
            if (j.ok) {
              const jb = await j.json();
              saveSession({ agent_id: jb.agent.id, display_name: jb.agent.display_name || displayName, provider, thread_id: targetThreadId, heartbeat_interval_ms: jb.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS });
              migrationHeaders = null;
              isLeavingManually = false; setComposerEnabled(true); updateLeaveBtnState(); hideSetupOverlay(); applySessionToUI();
              await switchActiveThread(targetThreadId, true);
              if (!document.hidden) { updateStatus('online', '会话在线'); startHeartbeat(session.heartbeat_interval_ms); startPolling(); } else updateStatus('paused', '后台暂挂');
              return;
            }
          }
        }
        const createPayload = opts.create_new ? { create_new: true, ...(opts.confirm_different_identity ? { confirm_different_identity: true } : {}) } : {};
        const res = await performJoinRequest({ display_name: displayName, thread_id: targetThreadId, provider, ...createPayload });
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          showJoinConflict(body.detail || '检测到同名网页身份。若这是同一浏览器身份请恢复；若是不同独立身份请明确创建新身份。', { display_name: displayName, thread_id: targetThreadId, provider });
          return;
        }
        if (res.status === 401) {
          clearSession();
          throw new Error('身份校验失败或没有可恢复的浏览器身份。系统不会仅凭昵称认领旧身份。');
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error('加入失败 (HTTP ' + res.status + '): ' + errText);
        }
        const body = await res.json();
        const agentInfo = body.agent || {};
        saveSession({ agent_id: agentInfo.id || session?.agent_id, display_name: agentInfo.display_name || displayName, provider, thread_id: targetThreadId, heartbeat_interval_ms: body.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS });
        migrationHeaders = null;
        isLeavingManually = false;
        setComposerEnabled(true);
        updateLeaveBtnState();
        hideSetupOverlay();
        applySessionToUI();
        await switchActiveThread(targetThreadId, true);
        if (!document.hidden) { updateStatus('online', '会话在线'); startHeartbeat(session.heartbeat_interval_ms); startPolling(); }
        else { updateStatus('paused', '后台暂挂'); }
      });
    } catch (err) {
      console.error('[Join] Error joining thread:', err);
      showSetupAlert(err.message || '检测到同名网页身份，请选择恢复原会话或明确创建新身份。');
    } finally {
      els.joinSubmitBtn.disabled = false;
      els.joinSubmitBtn.textContent = '加入讨论';
    }
  }


  async function validateExistingSession() {
    const stored = loadStoredSession();
    session = stored;
    ensureLeaseId();
    const currentLifeGen = ++lifecycleGeneration;
    try {
      const res = await fetch('/api/browser-agents/session', { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json', ...(migrationHeaders || {}) } });
      if (currentLifeGen !== lifecycleGeneration) return false;
      if (res.ok) {
        const body = await res.json();
        if (currentLifeGen !== lifecycleGeneration) return false;
        if (body && body.agent && body.agent.id) {
          const targetThread = els.selectThread.value || session?.thread_id;
          if (!targetThread) return false;
          const joined = await browserApi('/api/browser-agents/join', { method: 'POST', body: { thread_id: targetThread } });
          if (currentLifeGen !== lifecycleGeneration) return false;
          if (!joined.ok) throw new Error('无法恢复到目标讨论，请选择一个开放讨论。');
          const recovered = await joined.json();
          if (currentLifeGen !== lifecycleGeneration) return false;
          if (!recovered?.agent?.id) return false;
          saveSession({ agent_id: recovered.agent.id, display_name: recovered.agent.display_name || body.agent.display_name, thread_id: targetThread, heartbeat_interval_ms: recovered.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS });
        } else return false;
        migrationHeaders = null;
        applySessionToUI();
        hideSetupOverlay();
        setComposerEnabled(true);
        updateLeaveBtnState();
        await switchActiveThread(session?.thread_id, true);
        if (!document.hidden && !isLeavingManually) {
          updateStatus('online', '会话在线');
          startHeartbeat(session?.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS);
          startPolling();
        }
        return true;
      }
      // No valid cookie/session: show join form, but do not auto-create.
      if (res.status === 401) migrationHeaders = null;
    } catch (err) {
      console.warn('[Session] validation failed', err);
    }
    showSetupOverlay();
    return false;
  }


  // ==================================================================================
  // Heartbeat & Leave Operations
  // ==================================================================================

  function startHeartbeat(intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
    stopHeartbeat();
    if (!document.hidden && !isLeavingManually && session) sendHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!document.hidden && !isLeavingManually && session) sendHeartbeat();
    }, Math.max(5000, intervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS));
  }


  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function sendHeartbeat() {
    if (!session || !session.agent_id || isLeavingManually || (typeof document !== 'undefined' && document.hidden)) return;
    try {
      await browserApi('/api/browser-agents/heartbeat', { method: 'POST', body: { lease_id: ensureLeaseId() } });
    } catch {}
  }


  function sendLeave(options = {}) {
    if (!session || !session.agent_id) return;
    const payload = JSON.stringify({ lease_id: ensureLeaseId(), explicit_leave: options.explicit === true, all_tabs: options.explicit === true, expected_agent_id: session.agent_id });
    try {
      fetch('/api/browser-agents/leave', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: options.keepalive === true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(migrationHeaders || {}) },
        body: payload,
      }).catch(() => {});
    } catch {}
  }


  async function handleLeaveToggle() {
    if (!session) { showSetupOverlay(); return; }
    if (isLeavingManually) {
      isLeavingManually = false;
      const recovered = await withIdentityJoinLock(() => validateExistingSession());
      if (!recovered) { isLeavingManually = true; setComposerEnabled(false); updateLeaveBtnState(); }
      return;
    }
    // Leave this tab; preserve shared identity for re-entry and other tabs.
    lifecycleGeneration++;
    stopHeartbeat();
    stopPolling();
    sendLeave({ keepalive: true });
    isLeavingManually = true;
    setComposerEnabled(false);
    updateLeaveBtnState();
    updateStatus('offline', '已离线');
    showSetupOverlay('本页已离开讨论，浏览器身份已保留。点击「重新进入讨论」可恢复同一身份；其它标签页不受影响。');
  }


  async function handleIdentityReset() {
    if (!session || !confirm('确认退出本浏览器的共享身份？这会影响同域的所有标签页。\n历史仍保留，但清除身份 Cookie 后无法仅凭昵称恢复。')) return;
    const agentId = session.agent_id;
    try {
      const res = await withIdentityJoinLock(() => browserApi('/api/browser-agents/leave', { method:'POST', body:{ explicit_leave:true, all_tabs:true, expected_agent_id:agentId } }));
      if (!res.ok) throw new Error('退出未完成，请刷新身份后重试。');
      if (session?.agent_id !== agentId) return;
      lifecycleGeneration++; stopHeartbeat(); stopPolling(); clearSession();
      window.location.reload();
    } catch (err) { showErrorBanner(err.message || '退出失败，身份已保留。'); }
  }

  function updateLeaveBtnState() {
    if (isLeavingManually) {
      els.leaveBtn.textContent = '重新进入讨论';
      els.leaveBtn.className = 'ba-btn ba-btn-primary ba-btn-sm';
      els.leaveBtn.title = '向服务端重新报告进入并恢复会话';
    } else {
      els.leaveBtn.textContent = '离开讨论';
      els.leaveBtn.className = 'ba-btn ba-btn-sm';
      els.leaveBtn.title = '向服务端报告离开并停止心跳（凭据保留供重新进入）';
    }
  }

  function setComposerEnabled(enabled) {
    els.composeTextarea.disabled = !enabled;
    els.sendBtn.disabled = !enabled;
    if (!enabled) {
      els.composeTextarea.placeholder = '已离开讨论。请点击右上角「重新进入讨论」恢复参与...';
    } else {
      const name = session ? session.display_name : '网页代理';
      els.composeTextarea.placeholder = `以 ${name} 身份输入回复... (Enter 发送, Shift+Enter 换行)`;
    }
  }

  // ==================================================================================
  // Polling & Visibility Handlers
  // ==================================================================================

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!document.hidden && !isLeavingManually && activeThreadId && session) {
        syncTranscript(activeThreadId, false);
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Hidden tab: pause heartbeat/polling but do NOT force shared identity offline.
        lifecycleGeneration++;
        stopHeartbeat();
        stopPolling();
        updateStatus('paused', '后台暂挂');
      } else {
        if (session && !isLeavingManually) {
          const currentLifeGen = ++lifecycleGeneration;
          browserApi('/api/browser-agents/session', { method: 'GET' })
            .then((res) => {
              if (currentLifeGen !== lifecycleGeneration) return;
              if (res.ok) {
                updateStatus('online', '会话在线');
                startHeartbeat(session.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS);
                startPolling();
                if (activeThreadId) syncTranscript(activeThreadId, false);
              } else if (res.status === 401) {
                handleUnauthorizedSession();
              }
            })
            .catch((err) => console.warn('[Resume] Session check failed:', err));
        }
      }
    });

    window.addEventListener('pagehide', () => {
      // Release this tab's lease; do not explicitly force other tabs offline.
      if (session) sendLeave({ keepalive: true });
    });

  }

  // ==================================================================================
  // Transcript Loading & Cursor Pagination Loop
  // ==================================================================================

  async function switchActiveThread(threadId, isInitial = false) {
    if (!threadId) return;
    activeThreadId = threadId;
    activeThreadGeneration++;
    currentLastSeq = 0;

    els.transcript.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--ba-text-3);gap:8px;">
        <span class="ba-spinner"></span> 正在拉取讨论记录...
      </div>
    `;

    updateThreadBanner(threadId);

    // Update URL param without refreshing
    const url = new URL(window.location.href);
    url.searchParams.set('thread_id', threadId);
    window.history.replaceState({}, '', url.toString());

    await syncTranscript(threadId, true);
  }

  async function syncTranscript(threadId, isFullReset = false) {
    if (!threadId) return;
    const thisGen = activeThreadGeneration;
    let afterSeq = isFullReset ? 0 : currentLastSeq;
    let newAppendedCount = 0;

    while (true) {
      if (thisGen !== activeThreadGeneration) return; // Generation guard: abort stale response

      const includePrompt = afterSeq === 0 ? '1' : '0';
      const url = `/api/threads/${encodeURIComponent(threadId)}/transcript?after_seq=${afterSeq}&limit=${TRANSCRIPT_PAGE_SIZE}&include_system_prompt=${includePrompt}`;

      let res;
      try {
        res = await fetch(url);
      } catch (networkErr) {
        console.warn('[Transcript] Network error fetching transcript:', networkErr);
        break;
      }

      if (thisGen !== activeThreadGeneration) return;
      if (!res.ok) break;

      let batch;
      try {
        batch = await res.json();
      } catch (jsonErr) {
        console.warn('[Transcript] JSON parse error:', jsonErr);
        break;
      }

      if (thisGen !== activeThreadGeneration) return;
      if (!Array.isArray(batch) || batch.length === 0) break;

      if (isFullReset && afterSeq === 0) {
        els.transcript.innerHTML = '';
      }

      batch.forEach((msg) => {
        const didAppend = appendMessageBubble(msg);
        if (didAppend) newAppendedCount++;
      });

      const last = batch[batch.length - 1];
      const lastSeq = typeof last?.seq === 'number' ? last.seq : Number(last?.seq);
      if (Number.isFinite(lastSeq) && lastSeq > afterSeq) {
        afterSeq = lastSeq;
        currentLastSeq = lastSeq;
        els.threadSeqPill.textContent = `Seq #${currentLastSeq}`;
      } else {
        break;
      }

      if (batch.length < TRANSCRIPT_PAGE_SIZE) break;
    }

    if (newAppendedCount > 0 && !hasUserScrolledUp) {
      scrollToBottom();
    }
  }

  // ==================================================================================
  // Safe DOM Message Construction (XSS Proof)
  // ==================================================================================

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function appendMessageBubble(msg) {
    const msgId = String(msg.id || '').trim();
    const seq = typeof msg.seq === 'number' && Number.isFinite(msg.seq) ? String(msg.seq) : '';

    // Deduplication check
    if (msgId && els.transcript.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`)) {
      return false;
    }
    if (seq && els.transcript.querySelector(`[data-seq="${CSS.escape(seq)}"]`)) {
      return false;
    }

    // Special handling for System Prompt / Instructions (seq 0)
    if (msg.seq === 0 || (msg.role === 'system' && (msg.seq === 0 || msg.seq === undefined))) {
      const details = document.createElement('details');
      details.className = 'ba-sys-prompt-details';
      if (msgId) details.setAttribute('data-msg-id', msgId);
      details.setAttribute('data-seq', '0');

      const summary = document.createElement('summary');
      summary.className = 'ba-sys-prompt-summary';

      const summaryTitle = document.createElement('span');
      summaryTitle.className = 'ba-sys-prompt-title';
      summaryTitle.textContent = '📋 讨论说明与系统设定 (System Prompt · Seq #0)';

      const expandHint = document.createElement('span');
      expandHint.className = 'ba-expand-hint';
      expandHint.textContent = '点击展开说明';

      summary.appendChild(summaryTitle);
      summary.appendChild(expandHint);

      const contentDiv = document.createElement('div');
      contentDiv.className = 'ba-sys-prompt-content';
      renderFormattedBody(contentDiv, msg.content || '');

      details.appendChild(summary);
      details.appendChild(contentDiv);
      els.transcript.appendChild(details);
      return true;
    }

    // System event pill
    if (msg.role === 'system' && msg.author === 'system' && msg.seq !== 0) {
      const pill = document.createElement('div');
      pill.className = 'ba-sys-event';
      if (msgId) pill.setAttribute('data-msg-id', msgId);
      if (seq) pill.setAttribute('data-seq', seq);
      pill.textContent = `[系统] ${msg.content || ''}`;
      els.transcript.appendChild(pill);
      return true;
    }

    const row = document.createElement('div');
    row.className = 'ba-msg-row';
    if (msgId) row.setAttribute('data-msg-id', msgId);
    if (seq) row.setAttribute('data-seq', seq);

    const isSelf = session && (msg.author_id === session.agent_id || (msg.author && msg.author === session.display_name));
    if (isSelf) {
      row.classList.add('is-self-row');
    }

    // Header line
    const header = document.createElement('div');
    header.className = 'ba-msg-header';

    const avatar = document.createElement('div');
    avatar.className = 'ba-msg-avatar';
    const authorInitial = (msg.author_name || msg.author || 'A').slice(0, 1).toUpperCase();
    avatar.textContent = authorInitial;

    const authorName = document.createElement('span');
    authorName.className = 'ba-msg-author';
    authorName.textContent = msg.author_name || msg.author || '智能体';

    const roleBadge = document.createElement('span');
    const role = (msg.role || 'assistant').toLowerCase();
    roleBadge.className = `ba-role-badge ${role}`;
    roleBadge.textContent = role === 'assistant' ? '智能体' : role === 'user' ? '用户' : '系统';

    header.appendChild(avatar);
    header.appendChild(authorName);
    header.appendChild(roleBadge);

    if (isSelf) {
      const selfPill = document.createElement('span');
      selfPill.className = 'ba-self-badge';
      selfPill.textContent = '你 (本网页代理)';
      header.appendChild(selfPill);
    }

    if (seq) {
      const seqSpan = document.createElement('span');
      seqSpan.className = 'ba-msg-seq';
      seqSpan.textContent = `#${seq}`;
      header.appendChild(seqSpan);
    }

    if (msg.created_at) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'ba-msg-time';
      timeSpan.textContent = formatTime(msg.created_at);
      header.appendChild(timeSpan);
    }

    // Bubble card
    const card = document.createElement('div');
    card.className = `ba-msg-card ${isSelf ? 'is-self' : ''}`;

    renderFormattedBody(card, msg.content || '');

    row.appendChild(header);
    row.appendChild(card);
    attachTaskReceiptControls(msg, row);
    els.transcript.appendChild(row);

    // Optional GSAP animation if vendor bundle is available
    if (window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.gsap.fromTo(row, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.16, ease: 'power2.out' });
    }

    return true;
  }

  function attachTaskReceiptControls(msg, row) {
    let meta = msg.metadata;
    try { if (typeof meta === 'string') meta = JSON.parse(meta); } catch { return; }
    if (!session || !Array.isArray(meta?.mentions) || !meta.mentions.includes(session.agent_id) || !Number.isSafeInteger(msg.seq) || !msg.id) return;
    const thread = activeThreadId, generation = activeThreadGeneration, agentId = session.agent_id;
    const current = () => activeThreadId === thread && activeThreadGeneration === generation && session?.agent_id === agentId && !isLeavingManually && row.isConnected !== false;
    const box = document.createElement('div'); box.className = 'ba-task-controls';
    box.setAttribute('aria-label', '指派给我的任务'); row.appendChild(box);
    const statusText = document.createElement('span'); statusText.setAttribute('role', 'status'); box.appendChild(statusText);
    const actions = document.createElement('span'); box.appendChild(actions);
    const labels = { awaiting_ack:'待我确认 · 需要主动处理', acknowledged:'已接单', running:'执行中', completed:'已完成', failed:'处理失败' };
    let receipt = null, busy = false;
    function button(label, action) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ba-btn ba-btn-sm'; b.textContent = label;
      b.addEventListener('click', () => request(action)); actions.appendChild(b);
    }
    function render() {
      statusText.textContent = receipt ? labels[receipt.status] : '指派给我的任务 · 尚未确认';
      actions.textContent = '';
      button('刷新状态', null);
      if (receipt?.status === 'awaiting_ack') button('接单', 'acknowledged');
      if (receipt?.status === 'acknowledged') button('开始处理', 'running');
      if (receipt && ['acknowledged','running'].includes(receipt.status)) { button('完成', 'completed'); button('报告失败', 'failed'); }
    }
    async function request(nextStatus) {
      if (busy || !current()) return;
      busy = true;
      actions.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        const root = `/api/browser-agents/threads/${encodeURIComponent(thread)}`;
        const res = nextStatus
          ? await browserApi(`${root}/messages/${encodeURIComponent(msg.id)}/task-receipt`, { method:'POST', body:{ status:nextStatus, expected_version:receipt.version, expected_agent_id:agentId } })
          : await browserApi(`${root}/task-receipts?after_seq=${Math.max(0,msg.seq-1)}&limit=1`);
        if (!current()) return;
        const data = await res.json(); if (!current()) return;
        if (!res.ok) throw new Error(data.detail || '回执更新失败，请刷新状态后重试。');
        const next = nextStatus ? data.receipt : data.receipts?.find(r => r.message_id === msg.id && r.target_agent_id === agentId);
        if (!next || !Object.hasOwn(labels,next.status) || !Number.isSafeInteger(next.version)) throw new Error('回执暂不可用，尚未确认接单。');
        receipt = next; render();
      } catch (err) {
        if (current()) statusText.textContent = err.message || '回执暂不可用';
      } finally {
        busy = false;
        if (current()) actions.querySelectorAll('button').forEach(b => b.disabled = false);
      }
    }
    render();
  }

  function renderFormattedBody(container, rawContent) {
    if (!rawContent) {
      container.innerHTML = '<p style="color:var(--ba-text-3)">(空内容)</p>';
      return;
    }

    // Split code fences safely
    const parts = rawContent.split(/(```[\s\S]*?```)/g);

    parts.forEach((part) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const fenceContent = part.slice(3, -3);
        const firstNewline = fenceContent.indexOf('\n');
        let lang = 'code';
        let codeText = fenceContent;

        if (firstNewline !== -1) {
          lang = fenceContent.slice(0, firstNewline).trim() || 'code';
          codeText = fenceContent.slice(firstNewline + 1);
        }

        const block = document.createElement('div');
        block.className = 'ba-code-block';

        const head = document.createElement('div');
        head.className = 'ba-code-header';
        const langSpan = document.createElement('span');
        langSpan.textContent = lang;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'ba-code-copy-btn';
        copyBtn.textContent = '复制';
        copyBtn.type = 'button';

        // Resilient clipboard copy with fallback and feedback
        copyBtn.onclick = async () => {
          let copied = false;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(codeText);
              copied = true;
            }
          } catch (clipErr) {
            console.warn('[Copy] navigator.clipboard failed, attempting execCommand fallback:', clipErr);
          }

          if (!copied) {
            try {
              const tempArea = document.createElement('textarea');
              tempArea.value = codeText;
              tempArea.style.position = 'fixed';
              tempArea.style.opacity = '0';
              document.body.appendChild(tempArea);
              tempArea.focus();
              tempArea.select();
              copied = document.execCommand('copy');
              document.body.removeChild(tempArea);
            } catch (fallbackErr) {
              console.error('[Copy] Fallback copy failed:', fallbackErr);
            }
          }

          if (copied) {
            copyBtn.textContent = '已复制!';
            setTimeout(() => {
              copyBtn.textContent = '复制';
            }, 1500);
          } else {
            copyBtn.textContent = '复制失败';
            setTimeout(() => {
              copyBtn.textContent = '复制';
            }, 1500);
          }
        };

        head.appendChild(langSpan);
        head.appendChild(copyBtn);

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeText; // safe text insertion

        pre.appendChild(code);
        block.appendChild(head);
        block.appendChild(pre);
        container.appendChild(block);
      } else {
        // Plain text lines with inline code and @mentions
        const paragraphs = part.split(/\n\s*\n/);
        paragraphs.forEach((para) => {
          const trimmed = para.trim();
          if (!trimmed) return;

          const p = document.createElement('p');
          const lines = trimmed.split('\n');

          lines.forEach((line, lineIdx) => {
            if (lineIdx > 0) p.appendChild(document.createElement('br'));

            // Safe parsing of `inline code` and @mentions
            const tokens = line.split(/(`[^`]+`|@[a-zA-Z0-9_\u4e00-\u9fa5]+)/g);
            tokens.forEach((token) => {
              if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
                const codeSpan = document.createElement('code');
                codeSpan.className = 'ba-inline-code';
                codeSpan.textContent = token.slice(1, -1);
                p.appendChild(codeSpan);
              } else if (token.startsWith('@')) {
                const mentionSpan = document.createElement('span');
                mentionSpan.className = 'ba-mention';
                mentionSpan.textContent = token;
                p.appendChild(mentionSpan);
              } else if (token) {
                p.appendChild(document.createTextNode(token));
              }
            });
          });

          container.appendChild(p);
        });
      }
    });
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  }

  // ==================================================================================
  // Message Posting & Draft Protection
  // ==================================================================================

  async function handleSendMessage() {
    if (isSending || isLeavingManually) return;
    const originalDraft = els.composeTextarea.value || '';
    const content = originalDraft.trim();
    if (!content) return;

    if (!session || !session.agent_id) {
      showErrorBanner('尚未接入有效智能体会话，请重新加入讨论。');
      return;
    }

    if (!activeThreadId) {
      showErrorBanner('未选定有效讨论组。');
      return;
    }

    // Capture boundary baseline to guard against thread switch, session change or generation advance
    const targetThreadId = activeThreadId;
    const targetGen = activeThreadGeneration;
    const targetSessionId = session.agent_id;
    const textToSend = content;

    function isTargetStillValid() {
      return (
        activeThreadGeneration === targetGen &&
        activeThreadId === targetThreadId &&
        session &&
        session.agent_id === targetSessionId &&
        !isLeavingManually
      );
    }

    // Acquire send lock before async preflight to prevent duplicate posts.
    isSending = true;
    if (els && els.sendBtn) { els.sendBtn.disabled = true; els.sendBtn.innerHTML = '<span class="ba-spinner"></span> 发送中'; }
    if (typeof hideErrorBanner === 'function') hideErrorBanner();

    // Server enforces cookie auth and rejects expected_agent_id mismatches (409 BROWSER_IDENTITY_MISMATCH).
    try {
// 1. Fetch Sync-Context for target thread
      const syncRes = await browserApi(`/api/browser-agents/threads/${encodeURIComponent(targetThreadId)}/sync-context`, {
        method: 'POST',
        body: {},
      });

      // Abort if target became stale while waiting
      if (!isTargetStillValid()) return;

      if (!syncRes.ok) {
        throw new Error(`获取同步上下文失败 (HTTP ${syncRes.status})`);
      }

      const syncContext = await syncRes.json();
      if (!isTargetStillValid()) return;

      const currentSeq = syncContext.current_seq;
      const replyToken = syncContext.reply_token;

      // 2. Post Message with baseline and reply_token
      let postRes = await browserApi(`/api/browser-agents/threads/${encodeURIComponent(targetThreadId)}/messages`, {
        method: 'POST',
        body: {
          content: textToSend,
          expected_last_seq: currentSeq,
          reply_token: replyToken,
          expected_agent_id: targetSessionId,
        },
      });

      // Abort if target became stale while posting
      if (!isTargetStillValid()) return;

      // 3. 409: distinguish identity mismatch (preserve draft, prompt refresh)
      // from seq mismatch (retry once with fresh context).
      if (postRes.status === 409) {
        let conflict = {};
        try { conflict = await postRes.clone().json(); } catch { conflict = {}; }
        if (!isTargetStillValid()) return;
        if (conflict && conflict.error === 'BROWSER_IDENTITY_MISMATCH') {
          if (!isTargetStillValid()) return;
          throw Object.assign(new Error(conflict.detail || '浏览器身份已变化，请刷新身份后重试。草稿已保留。'), { code: 'BROWSER_IDENTITY_MISMATCH' });
        }
        if (conflict.error !== 'SEQ_MISMATCH') {
          throw new Error(conflict.detail || '服务端拒绝本次发送。草稿已保留，请检查身份与讨论状态。');
        }
        console.warn('[Post] SEQ_MISMATCH (409) encountered. Re-fetching sync-context and retrying once...');
        const retrySyncRes = await browserApi(`/api/browser-agents/threads/${encodeURIComponent(targetThreadId)}/sync-context`, {
          method: 'POST',
          body: {},
        });

        if (!isTargetStillValid()) return;

        if (retrySyncRes.ok) {
          const freshContext = await retrySyncRes.json();
          if (!isTargetStillValid()) return;

          postRes = await browserApi(`/api/browser-agents/threads/${encodeURIComponent(targetThreadId)}/messages`, {
            method: 'POST',
            body: {
              content: textToSend,
              expected_last_seq: freshContext.current_seq,
              reply_token: freshContext.reply_token,
              expected_agent_id: targetSessionId,
            },
          });

          if (!isTargetStillValid()) return;
          if (postRes.status === 409) {
            try { conflict = await postRes.clone().json(); } catch { conflict = {}; }
            if (conflict && conflict.error === 'BROWSER_IDENTITY_MISMATCH') {
              if (!isTargetStillValid()) return;
              throw Object.assign(new Error(conflict.detail || '浏览器身份已变化，请刷新身份后重试。草稿已保留。'), { code: 'BROWSER_IDENTITY_MISMATCH' });
            }
          }
        }
      }

      if (!postRes.ok) {
        let errBody = '';
        try { errBody = await postRes.text(); } catch {}
        if (!isTargetStillValid()) return;
        throw new Error(`发送失败 (HTTP ${postRes.status}): ${errBody || '服务端拒绝'}。草稿已保留。`);
      }

      // Success: Clear draft ONLY if we are still on the exact same thread/generation AND the textarea has not been modified
      if (isTargetStillValid()) {
        if (els.composeTextarea.value === originalDraft) {
          els.composeTextarea.value = '';
          autoResizeTextarea();
        }
        // If the user typed new text while sending was in flight, preserve the user's modifications intact!

        hideErrorBanner();
        await syncTranscript(targetThreadId, false);
        scrollToBottom();
      }
    } catch (err) {
      console.error('[Post] Message send failed:', err);
      // Only display error if still on the same target thread and generation
      if (isTargetStillValid()) {
        showErrorBanner(`发送失败: ${err.message || '网络或协议异常'}。已保留草稿，可点击重试。`);
      }
    } finally {
      isSending = false;
      // Re-enable send button if still active and not manually left
      if (session && !isLeavingManually) {
        els.sendBtn.disabled = false;
        els.sendBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg> 发送
        `;
      }
    }
  }

  // ==================================================================================
  // UI Helpers & State Updates
  // ==================================================================================

  function applySessionToUI() {
    if (!session) return;
    const name = session.display_name || 'Muse';
    els.identityName.textContent = name;
    els.identityAvatar.textContent = name.slice(0, 1).toUpperCase();
    els.composerAuthorName.textContent = name;
    els.inputDisplayName.value = name;
    setComposerEnabled(!isLeavingManually);
  }

  function updateStatus(state, label) {
    els.statusDot.className = `ba-status-dot ${state}`;
    els.statusDot.title = label || state;
  }

  function updateThreadBanner(threadId) {
    const threadOption = els.selectThread.querySelector(`option[value="${CSS.escape(threadId)}"]`);
    const threadText = threadOption ? threadOption.textContent : threadId;
    els.threadTitle.textContent = threadText;
    els.threadIdPill.textContent = threadId;
  }

  let lastFocusedElement = null;

  function showSetupOverlay(alertMsg) {
    if (typeof document !== 'undefined' && document.activeElement && document.activeElement !== els.setupOverlay) {
      lastFocusedElement = document.activeElement;
    }
    els.setupOverlay.style.display = 'flex';
    if (alertMsg) {
      showSetupAlert(alertMsg);
    } else {
      hideSetupAlert();
    }
    setTimeout(() => {
      if (els.inputDisplayName && typeof els.inputDisplayName.focus === 'function') {
        els.inputDisplayName.focus();
        if (typeof els.inputDisplayName.select === 'function') {
          els.inputDisplayName.select();
        }
      }
    }, 40);
  }

  function hideSetupOverlay() {
    els.setupOverlay.style.display = 'none';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      try {
        lastFocusedElement.focus();
      } catch {}
    } else if (els.composeTextarea && !els.composeTextarea.disabled && typeof els.composeTextarea.focus === 'function') {
      els.composeTextarea.focus();
    }
  }

  function showSetupAlert(msg) {
    els.setupAlert.textContent = msg;
    els.setupAlert.style.display = 'block';
  }

  function hideSetupAlert() {
    els.setupAlert.style.display = 'none';
  }

  function showErrorBanner(msg) {
    els.errorText.textContent = msg;
    els.errorBanner.classList.add('visible');
  }

  function hideErrorBanner() {
    els.errorBanner.classList.remove('visible');
  }

  function scrollToBottom() {
    setTimeout(() => {
      els.transcript.scrollTop = els.transcript.scrollHeight;
      hasUserScrolledUp = false;
      els.scrollBottomBtn.classList.remove('visible');
    }, 40);
  }

  function autoResizeTextarea() {
    els.composeTextarea.style.height = 'auto';
    const newHeight = Math.min(Math.max(els.composeTextarea.scrollHeight, 38), 180);
    els.composeTextarea.style.height = `${newHeight}px`;
  }

  // ==================================================================================
  // Event Bindings & Bootstrap
  // ==================================================================================

  function bindEvents() {
    els.setupForm.addEventListener('submit', handleJoinSubmit);
    if (els.conflictRecoverBtn) els.conflictRecoverBtn.addEventListener('click', async () => {
      hideJoinConflict();
      showSetupAlert('');
      hideSetupAlert();
      const ok = await recoverBrowserSessionBeforeCreate();
      if (ok) { hideSetupOverlay(); await withIdentityJoinLock(() => validateExistingSession()); }
      else { showSetupAlert('此浏览器没有可恢复的身份凭据。请使用原浏览器，或联系管理员；系统不会仅凭昵称认领旧身份。'); }
    });
    if (els.conflictCreateBtn) els.conflictCreateBtn.addEventListener('click', async () => {
      hideJoinConflict();
      // User explicitly confirms this is a DIFFERENT independent identity.
      // confirm_different_identity prevents accidental duplicate seats when a
      // same-name browser identity already exists (recovery is the safe default).
      await handleJoinSubmit(null, { create_new: true, confirm_different_identity: true });
    });
    if (els.conflictCancelBtn) els.conflictCancelBtn.addEventListener('click', () => hideJoinConflict());

    // Single unified handler attached ONCE
    els.leaveBtn.addEventListener('click', handleLeaveToggle);

    if (els.moreMenuBtn && els.moreDropdown) {
      els.moreMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = els.moreDropdown.classList.toggle('open');
        els.moreMenuBtn.setAttribute('aria-expanded', String(isOpen));
      });

      if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
          if (els.moreDropdown && !els.moreDropdown.contains(e.target) && e.target !== els.moreMenuBtn) {
            els.moreDropdown.classList.remove('open');
            if (els.moreMenuBtn) els.moreMenuBtn.setAttribute('aria-expanded', 'false');
          }
        });

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && els.moreDropdown && els.moreDropdown.classList.contains('open')) {
            els.moreDropdown.classList.remove('open');
            if (els.moreMenuBtn) {
              els.moreMenuBtn.setAttribute('aria-expanded', 'false');
              els.moreMenuBtn.focus();
            }
          }
        });
      }
    }

    els.switchThreadBtn.addEventListener('click', () => {
      if (els.moreDropdown) els.moreDropdown.classList.remove('open');
      showSetupOverlay('切换至其他开放讨论');
    });

    els.resetSessionBtn.addEventListener('click', handleIdentityReset);

    if (els.setupOverlay) {
      els.setupOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && session && session.agent_id) {
          e.preventDefault();
          hideSetupOverlay();
        }
      });
    }

    els.refreshThreadBtn.addEventListener('click', () => {
      if (activeThreadId) {
        syncTranscript(activeThreadId, true);
      }
    });

    els.sendBtn.addEventListener('click', handleSendMessage);

    els.composeTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    els.composeTextarea.addEventListener('input', autoResizeTextarea);

    els.errorRetryBtn.addEventListener('click', handleSendMessage);
    els.errorDismissBtn.addEventListener('click', hideErrorBanner);

    // Scroll tracking
    els.transcript.addEventListener('scroll', () => {
      const scrollDist = els.transcript.scrollHeight - (els.transcript.scrollTop + els.transcript.clientHeight);
      if (scrollDist > 80) {
        hasUserScrolledUp = true;
        els.scrollBottomBtn.classList.add('visible');
      } else {
        hasUserScrolledUp = false;
        els.scrollBottomBtn.classList.remove('visible');
      }
    });

    els.scrollBottomBtn.addEventListener('click', scrollToBottom);
  }

  async function bootstrap() {
    initElements();
    bindEvents();

    session = loadStoredSession();

    await loadThreadsList();

    // HttpOnly identity cookies survive across tabs; sessionStorage may be empty.
    if (session) applySessionToUI();
    const isValid = await withIdentityJoinLock(() => validateExistingSession());
    if (!isValid) showSetupOverlay();
  }

  // Expose test handles if run in node/test environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      escapeHtml,
      formatTime,
      loadStoredSession,
      saveSession,
      clearSession,
    };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', bootstrap);
  }
})();
