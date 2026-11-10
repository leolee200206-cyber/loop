/**
 * AgentChatBus 3D Spatial Arena V2
 * Clean Linear Dark Aesthetic + GSAP Motion Engine
 */
(function() {
  'use strict';

  // Camera single source of truth
  const cameraState = {
    rotX: 22,
    rotY: 0
  };

  // Stage offset for Inspector Drawer dynamic compensation
  const stageOffset = {
    offsetX: 0,
    offsetY: 0
  };

  let activeCameraTween = null;
  let activeStageTween = null;
  let isInspectorOpen = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentMode = 'timeline';
  let isFrozen = true;

  // Stored state for current thread
  let currentThreadId = null;
  let currentParticipants = [];
  let currentMessages = [];
  let selectedAgentId = null;

  class Acb3DArena {
    constructor() {
      this.container = null;
      this.stage = null;
      this.svgLayer = null;
      this.drawer = null;
      this.rosterEl = null;
      this.isInitialized = false;
    }

    init() {
      if (this.isInitialized && this.container && this.container.childElementCount > 0) return;
      this.container = document.getElementById('acb-3d-arena');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'acb-3d-arena';
        this.container.style.display = 'none';
        const wrap = document.getElementById('messages-wrap');
        const chatBody = document.getElementById('chat-body');
        if (wrap && chatBody) {
          wrap.insertBefore(this.container, chatBody);
        } else if (wrap) {
          wrap.appendChild(this.container);
        } else {
          document.body.appendChild(this.container);
        }
      }

      this.buildDom();
      this.bindEvents();
      this.isInitialized = true;

      // Handle prefers-reduced-motion
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.container.classList.add('reduced-motion');
      }
    }

    buildDom() {
      this.container.innerHTML = [
        '<!-- Floating Top-Right Tool Strip -->',
        '<div class="acb-arena-toolbar">',
        '  <button id="acb-reset-cam-btn" class="acb-arena-btn" type="button" title="复位视角">',
        '    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>',
        '    <span>复位视角</span>',
        '  </button>',
        '  <button id="acb-focus-speaker-btn" class="acb-arena-btn" type="button" title="聚焦最新发言">',
        '    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>',
        '    <span>聚焦发言</span>',
        '  </button>',
        '</div>',
        '',
        '<!-- 3D Stage -->',
        '<div class="acb-3d-stage" id="acb-3d-stage">',
        '  <div class="acb-3d-floor"></div>',
        '  <div class="acb-orbit-ellipse" id="acb-orbit-ellipse"></div>',
        '  <div class="acb-topic-core" id="acb-topic-core">',
        '    <span class="acb-topic-core__tag">讨论空间</span>',
        '    <span class="acb-topic-core__name" id="acb-stage-topic-name">AgentChatBus</span>',
        '  </div>',
        '  <div id="acb-seats-container"></div>',
        '</div>',
        '',
        '<!-- SVG Bezier Flow Layer -->',
        '<svg class="acb-3d-svg-flow-layer" id="acb-svg-flow" xmlns="http://www.w3.org/2000/svg"></svg>',
        '',
        '<!-- Right Slide-Out Inspector Drawer -->',
        '<aside class="acb-inspector-drawer" id="acb-inspector-drawer" aria-label="智能体详情">',
        '  <div class="acb-inspector-header">',
        '    <div style="display:flex;align-items:center;gap:10px;">',
        '      <span id="drawer-agent-avatar" style="font-size:20px;">🤖</span>',
        '      <div>',
        '        <div id="drawer-agent-name" style="font-size:13px;font-weight:600;color:var(--text-1,#f0f2f5);">智能体</div>',
        '        <div id="drawer-agent-badge" style="font-size:10px;color:var(--text-2,#8b949e);">客户端</div>',
        '      </div>',
        '    </div>',
        '    <button class="acb-inspector-close-btn" id="drawer-close-btn" type="button" aria-label="关闭详情">✕</button>',
        '  </div>',
        '  <div class="acb-inspector-body">',
        '    <div>',
        '      <div class="acb-inspector-section-title">状态与证据</div>',
        '      <div id="drawer-agent-status" style="font-size:12px;color:var(--text-1,#f0f2f5);margin-bottom:4px;">已注册但离线</div>',
        '      <div id="drawer-agent-client-type" style="font-size:11px;color:var(--text-3,#57606a);">client_type: desktop</div>',
        '    </div>',
        '    <div>',
        '      <div class="acb-inspector-section-title">最新发言内容</div>',
        '      <div class="acb-inspector-quote" id="drawer-agent-quote">（暂无发言）</div>',
        '    </div>',
        '    <button class="acb-inspector-action-btn" id="drawer-locate-btn" type="button">',
        '      <span>在时间线中定位发言 ↗</span>',
        '    </button>',
        '  </div>',
        '</aside>'
      ].join('\n');

      this.stage = document.getElementById('acb-3d-stage');
      this.svgLayer = document.getElementById('acb-svg-flow');
      this.drawer = document.getElementById('acb-inspector-drawer');

      document.getElementById('acb-reset-cam-btn')?.addEventListener('click', () => this.resetCamera());
      document.getElementById('acb-focus-speaker-btn')?.addEventListener('click', () => this.focusLatestSpeaker());
      document.getElementById('drawer-close-btn')?.addEventListener('click', () => this.closeInspector());
      document.getElementById('drawer-locate-btn')?.addEventListener('click', () => this.locateInTimeline());
    }

    bindEvents() {
      if (!this.container) return;

      const onPointerDown = (e) => {
        if (e.target.closest('.acb-arena-toolbar') || e.target.closest('.acb-inspector-drawer') || e.target.closest('.acb-seat-node')) {
          return;
        }
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;

        cameraState.rotY += dx * 0.35;
        cameraState.rotX = Math.max(5, Math.min(65, cameraState.rotX - dy * 0.3));

        if (activeCameraTween) {
          activeCameraTween.kill();
          activeCameraTween = null;
        }
        this.updateCamera();
      };

      const onPointerUp = () => {
        isDragging = false;
      };

      this.container.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      window.addEventListener('resize', () => {
        if (!isFrozen && currentMode !== 'timeline') {
          this.render();
        }
      });

      window.addEventListener('acb-avatar-bindings-changed', () => {
        if (!isFrozen && currentMode !== 'timeline') {
          this.render();
        }
      });
    }

    updateCamera() {
      if (!this.stage) return;
      this.stage.style.left = `calc(50% + ${stageOffset.offsetX}px)`;
      this.stage.style.top = `calc(50% + ${stageOffset.offsetY}px)`;
      this.stage.style.transform = `rotateX(${cameraState.rotX}deg) rotateY(${cameraState.rotY}deg)`;

      // Update reverse rotation on billboard seats to keep them facing the camera unskewed
      const seats = this.container.querySelectorAll('.acb-seat-node');
      seats.forEach((seat) => {
        const x = seat.dataset.x || 0;
        const y = seat.dataset.y || 0;
        const z = seat.dataset.z || 0;
        seat.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateY(${-cameraState.rotY}deg) rotateX(${-cameraState.rotX}deg)`;
      });

      this.renderFlowArcs();
    }

    resetCamera() {
      if (typeof gsap === 'undefined') {
        cameraState.rotX = 22;
        cameraState.rotY = 0;
        this.updateCamera();
        return;
      }

      if (activeCameraTween) {
        activeCameraTween.kill();
      }

      activeCameraTween = gsap.to(cameraState, {
        rotX: 22,
        rotY: 0,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => this.updateCamera(),
        onComplete: () => { activeCameraTween = null; }
      });
    }

    focusLatestSpeaker() {
      if (!currentParticipants.length) return;
      // Find latest speaker from messages
      let latestAuthor = null;
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        const m = currentMessages[i];
        if (m && m.author) {
          latestAuthor = m.author;
          break;
        }
      }

      const speaker = currentParticipants.find(p => p.id === latestAuthor || p.name === latestAuthor) || currentParticipants[0];
      if (speaker) {
        this.selectAgent(speaker.id);
      }
    }

    selectAgent(agentId) {
      selectedAgentId = agentId;
      const p = currentParticipants.find(item => item.id === agentId || item.name === agentId);
      if (!p) return;

      // Update seat active state
      const seats = this.container.querySelectorAll('.acb-seat-node');
      seats.forEach(s => {
        if (s.dataset.agentId === p.id) {
          s.classList.add('active');
        } else {
          s.classList.remove('active');
        }
      });

      // Find latest message by this agent
      let lastMsg = null;
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        const m = currentMessages[i];
        if (m && (m.author === p.id || m.author === p.name || m.author_name === p.name)) {
          lastMsg = m;
          break;
        }
      }

      this.openInspector(p, lastMsg);
      this.renderFlowArcs();
    }

    openInspector(participant, message) {
      if (!this.drawer) return;
      document.getElementById('drawer-agent-avatar').textContent = participant.emoji || '🤖';
      document.getElementById('drawer-agent-name').textContent = participant.name || '智能体';
      
      const badgeText = participant.client_type === 'desktop' ? '桌面端客户端 (Verified)' : (participant.client_type === 'cli' ? 'CLI 会话' : '席位');
      document.getElementById('drawer-agent-badge').textContent = badgeText;

      const statusEl = document.getElementById('drawer-agent-status');
      if (participant.online) {
        statusEl.innerHTML = '<span style="color:#10b981;">●</span> 活跃在线';
      } else {
        statusEl.innerHTML = '<span style="color:#8b949e;">○</span> 已注册但离线 (delivery=pull)';
      }

      document.getElementById('drawer-agent-client-type').textContent = `client_type: ${participant.client_type || 'unknown'}`;

      const quoteEl = document.getElementById('drawer-agent-quote');
      if (message && message.content) {
        quoteEl.textContent = message.content;
        quoteEl.dataset.msgId = message.id || message.msg_id || '';
      } else {
        quoteEl.textContent = '（该席位在当前窗口中暂无发言）';
        quoteEl.dataset.msgId = '';
      }

      isInspectorOpen = true;
      this.drawer.classList.add('open');

      // Dynamic stage relayout: Available stage width W_avail = W_stage - drawerWidth.
      // Shift stage origin left by drawerWidth / 2 so seats orbit is centered in visible stage,
      // preventing right-hand seats from being obscured by the drawer.
      const W = this.container ? (this.container.clientWidth || 800) : 800;
      const isNarrow = W < 650;
      this.drawer.classList.toggle('drawer--bottom-sheet', isNarrow);
      const drawerWidth = isNarrow ? 0 : 340;
      const targetOffsetX = isNarrow ? 0 : -Math.round(drawerWidth / 2);
      const targetOffsetY = isNarrow ? -20 : 0;

      const gsapInstance = typeof gsap !== 'undefined' ? gsap : (window.AcbAnimations?.isAvailable() ? window.gsap : null);
      const isReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (gsapInstance && !isReduced && this.stage) {
        if (activeStageTween) {
          if (window.AcbAnimations?.untrack) window.AcbAnimations.untrack(activeStageTween);
          activeStageTween.kill();
          activeStageTween = null;
        }
        activeStageTween = gsapInstance.to(stageOffset, {
          offsetX: targetOffsetX,
          offsetY: targetOffsetY,
          duration: 0.22,
          ease: 'power2.out',
          onUpdate: () => {
            if (this.stage) {
              this.stage.style.left = `calc(50% + ${stageOffset.offsetX}px)`;
              this.stage.style.top = `calc(50% + ${stageOffset.offsetY}px)`;
            }
            this.renderFlowArcs();
          },
          onComplete: () => {
            if (window.AcbAnimations?.untrack) window.AcbAnimations.untrack(activeStageTween);
            activeStageTween = null;
          }
        });
        if (window.AcbAnimations?.track) window.AcbAnimations.track(activeStageTween);
        if (window.AcbAnimations && typeof window.AcbAnimations.animateDrawer === 'function') {
          window.AcbAnimations.animateDrawer(this.drawer, true, isNarrow);
        }
      } else {
        stageOffset.offsetX = targetOffsetX;
        stageOffset.offsetY = targetOffsetY;
        if (this.stage) {
          this.stage.style.left = `calc(50% + ${stageOffset.offsetX}px)`;
          this.stage.style.top = `calc(50% + ${stageOffset.offsetY}px)`;
        }
      }

      this.render();
    }

    closeInspector() {
      isInspectorOpen = false;
      if (this.drawer) {
        this.drawer.classList.remove('open');
        this.drawer.classList.remove('drawer--bottom-sheet');
      }
      selectedAgentId = null;
      const seats = this.container?.querySelectorAll('.acb-seat-node');
      seats?.forEach(s => s.classList.remove('active'));

      const W = this.container ? (this.container.clientWidth || 800) : 800;
      const isNarrow = W < 650;
      const gsapInstance = typeof gsap !== 'undefined' ? gsap : (window.AcbAnimations?.isAvailable() ? window.gsap : null);
      const isReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (gsapInstance && !isReduced && this.stage) {
        if (activeStageTween) {
          if (window.AcbAnimations?.untrack) window.AcbAnimations.untrack(activeStageTween);
          activeStageTween.kill();
          activeStageTween = null;
        }
        activeStageTween = gsapInstance.to(stageOffset, {
          offsetX: 0,
          offsetY: 0,
          duration: 0.2,
          ease: 'power2.out',
          onUpdate: () => {
            if (this.stage) {
              this.stage.style.left = `calc(50% + ${stageOffset.offsetX}px)`;
              this.stage.style.top = `calc(50% + ${stageOffset.offsetY}px)`;
            }
            this.renderFlowArcs();
          },
          onComplete: () => {
            if (window.AcbAnimations?.untrack) window.AcbAnimations.untrack(activeStageTween);
            activeStageTween = null;
          }
        });
        if (window.AcbAnimations?.track) window.AcbAnimations.track(activeStageTween);
        if (window.AcbAnimations && typeof window.AcbAnimations.animateDrawer === 'function') {
          window.AcbAnimations.animateDrawer(this.drawer, false, isNarrow);
        }
      } else {
        stageOffset.offsetX = 0;
        stageOffset.offsetY = 0;
        if (this.stage) {
          this.stage.style.left = '50%';
          this.stage.style.top = '50%';
        }
      }

      this.render();
      this.renderFlowArcs();
    }

    locateInTimeline() {
      const quoteEl = document.getElementById('drawer-agent-quote');
      const msgId = quoteEl?.dataset?.msgId;
      this.setMode('timeline');
      if (msgId) {
        setTimeout(() => {
          const el = document.getElementById(`msg-${msgId}`) || document.querySelector(`[data-msg-id="${msgId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('message--highlighted');
            setTimeout(() => el.classList.remove('message--highlighted'), 2000);
          }
        }, 150);
      }
    }

    openRosterDrawer() {
      if (currentParticipants.length > 0) {
        this.selectAgent(currentParticipants[0].id);
      }
    }

    onNewMessage(m) {
      if (!m) return;
      currentMessages.push(m);
      if (!isFrozen && currentMode !== 'timeline') {
        this.render();
      }
    }

    updateAgentsPresence(agents, onlineKeys) {
      if (!currentParticipants || !currentParticipants.length) return;
      let changed = false;
      currentParticipants.forEach((p) => {
        const meta = agents?.find((a) => a.id === p.id || a.name === p.name);
        const isOnline = Boolean((onlineKeys && onlineKeys.has(p.id)) || meta?.is_online === true || meta?.online === true);
        if (p.online !== isOnline) {
          p.online = isOnline;
          changed = true;
        }
      });
      if (changed) {
        this.updateHeaderRoster();
        if (currentMode !== 'timeline') {
          this.render();
        }
      }
    }

    updateThread(threadId, participants, messages, topic) {
      currentThreadId = threadId;
      currentParticipants = participants || [];
      currentMessages = messages || [];

      this.init();

      // Update topic title in center topic ring
      const topicEl = document.getElementById('acb-stage-topic-name');
      if (topicEl && topic) {
        topicEl.textContent = topic;
      }

      // Update Header Compact Roster Pill
      this.updateHeaderRoster();

      this.render();
    }

    updateHeaderRoster() {
      const rosterAvatars = document.getElementById('roster-avatars');
      const rosterText = document.getElementById('roster-count-text');
      if (!rosterAvatars || !rosterText) return;

      rosterAvatars.innerHTML = '';
      let onlineCount = 0;

      const validAgents = (currentParticipants || []).filter(p => {
        const idLower = String(p.id || '').toLowerCase();
        const nameLower = String(p.name || '').toLowerCase();
        return idLower !== 'system' && nameLower !== 'system' && idLower !== 'human' && nameLower !== 'human' && !p.is_user;
      });

      validAgents.forEach((p) => {
        if (p.online) onlineCount++;
        const span = document.createElement('span');
        span.className = 'roster-avatar';
        span.textContent = p.emoji || '🤖';
        rosterAvatars.appendChild(span);
      });

      rosterText.textContent = `${validAgents.length} 智能体 (${onlineCount} 在线)`;
    }

    render() {
      if (!this.container || !this.stage) return;
      const seatsContainer = document.getElementById('acb-seats-container');
      if (!seatsContainer) return;

      seatsContainer.innerHTML = '';

      // Compute dynamic arena radius strictly constrained by card bounding box
      const W = this.container.clientWidth || 800;
      const H = this.container.clientHeight || 500;
      
      const isNarrow = W < 500;
      const halfCardW = isNarrow ? 56 : 68;
      const safePaddingX = isNarrow ? 18 : 32;
      const safeMarginX = halfCardW + safePaddingX;

      const halfCardH = isNarrow ? 20 : 24;
      const safePaddingY = isNarrow ? 20 : 28;
      const safeMarginY = halfCardH + safePaddingY;

      // Available width deduction when inspector is open on desktop
      const effectiveDrawerW = (isInspectorOpen && W >= 650) ? 340 : 0;
      const W_avail = Math.max(300, W - effectiveDrawerW);

      // Max allowed radius guarantees card edges NEVER cross visible bounds [0, W_avail] and [0, H]
      const maxAllowedRx = Math.max(60, Math.floor((W_avail / 2) - safeMarginX));
      const maxAllowedRy = Math.max(45, Math.floor((H / 2) - safeMarginY));

      const targetRx = Math.round(W_avail * (isNarrow ? 0.28 : (currentMode === 'split' ? 0.30 : 0.34)));
      const targetRy = Math.round(H * (isNarrow ? 0.22 : 0.25));

      const rx = Math.max(60, Math.min(targetRx, maxAllowedRx, 420));
      const ry = Math.max(45, Math.min(targetRy, maxAllowedRy, 200));

      // Update orbit ellipse size
      const ellipse = document.getElementById('acb-orbit-ellipse');
      if (ellipse) {
        ellipse.style.width = `${rx * 2}px`;
        ellipse.style.height = `${ry * 2}px`;
      }

      const seatSeen = new Set();
      const seats = (currentParticipants || []).filter(p => {
        const id = String(p?.id || '').trim();
        if (id) {
          if (seatSeen.has(id)) return false;
          seatSeen.add(id);
        }
        const idLower = id.toLowerCase();
        const nameLower = String(p?.name || '').toLowerCase();
        return idLower !== 'system' && nameLower !== 'system' && idLower !== 'human' && nameLower !== 'human' && !p.is_user;
      });

      const N = seats.length;
      if (N === 0) return;

      // Identify latest speaker
      let latestSpeakerId = null;
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        const m = currentMessages[i];
        if (m && m.author) {
          latestSpeakerId = m.author;
          break;
        }
      }

      seats.forEach((p, index) => {
        // Distribute evenly along the ellipse perimeter
        // For 3 agents: index 0 is front-center, index 1 is top-left, index 2 is top-right
        const angle = (index * (2 * Math.PI / N)) + (Math.PI / 2);
        const x = Math.round(rx * Math.cos(angle));
        const y = Math.round(ry * Math.sin(angle));
        const z = Math.round((ry * Math.sin(angle)) * 0.35);

        const isLatestSpeaker = (p.id === latestSpeakerId || p.name === latestSpeakerId);
        const isSelected = (p.id === selectedAgentId);

        const seatNode = document.createElement('div');
        seatNode.className = 'acb-seat-node' + (isSelected ? ' active' : '') + (isLatestSpeaker ? ' speaking' : '');
        seatNode.dataset.agentId = p.id;
        seatNode.dataset.x = x;
        seatNode.dataset.y = y;
        seatNode.dataset.z = z;

        // Reverse billboard rotation to face camera
        seatNode.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateY(${-cameraState.rotY}deg) rotateX(${-cameraState.rotX}deg)`;

        const isWebSession = Boolean(
          p.capabilities?.includes('browser-ui') ||
          p.capabilities?.includes('web-session-presence') ||
          String(p.model || '').toLowerCase().includes('web session') ||
          p.last_activity?.startsWith('browser_') ||
          p.client_type === 'browser' ||
          p.is_web
        );
        const onlineClass = p.online ? (isWebSession ? 'browser' : 'online') : '';
        const seatState = p.online ? (isWebSession ? 'browser_session' : 'online') : 'offline';
        seatNode.dataset.state = seatState;

        const clientBadgeHtml = isWebSession
          ? '<span class="acb-seat-badge browser">网页会话</span>'
          : (p.client_type === 'desktop'
              ? '<span class="acb-seat-badge desktop">桌面端</span>'
              : (p.client_type === 'cli' ? '<span class="acb-seat-badge cli">CLI</span>' : '<span class="acb-seat-badge agent">席位</span>'));

        const speakingBadgeHtml = isLatestSpeaker
          ? '<span class="acb-seat-badge speaking">最新发言</span>'
          : '';

        const displayName = String(p.display_name || p.name || (p.id ? p.id.slice(0, 8) : 'Agent')).trim();
        const avatarEmoji = String(p.emoji || '').trim() || (isWebSession ? '🌐' : (p.client_type === 'desktop' ? '💻' : '🤖'));
        const resolvedAvatar = window.AcbAvatarSystem ? window.AcbAvatarSystem.resolveAgentAvatar(p) : null;
        let avatarInnerHtml = `<span>${avatarEmoji}</span>`;
        if (resolvedAvatar && resolvedAvatar.webp) {
          avatarInnerHtml = `<img src="${resolvedAvatar.webp}" alt="${displayName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;pointer-events:none;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" /><span style="display:none;">${avatarEmoji}</span>`;
        }

        seatNode.innerHTML = [
          '<div class="acb-seat-billboard">',
          `  <div class="acb-seat-avatar" data-state="${seatState}" title="点击查看 3D 虚拟形象">`,
          `    ${avatarInnerHtml}`,
          `    <span class="acb-seat-online-dot ${onlineClass}"></span>`,
          '  </div>',
          '  <div class="acb-seat-info">',
          `    <div class="acb-seat-name">${displayName}</div>`,
          '    <div class="acb-seat-badges">',
          `      ${clientBadgeHtml}`,
          `      ${speakingBadgeHtml}`,
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');

        const avatarEl = seatNode.querySelector('.acb-seat-avatar');
        if (avatarEl) {
          avatarEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.AcbAvatarViewer && resolvedAvatar?.key && resolvedAvatar.key !== 'custom') {
              window.AcbAvatarViewer.open(resolvedAvatar.key, p.id);
            } else {
              this.selectAgent(p.id);
            }
          });
        }

        seatNode.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectAgent(p.id);
        });

        seatsContainer.appendChild(seatNode);
      });

      this.updateCamera();
      this.renderFlowArcs();
    }

    renderFlowArcs() {
      if (!this.svgLayer || isFrozen || currentMode === 'timeline') return;
      this.svgLayer.innerHTML = '';

      if (!currentParticipants.length || !currentMessages.length) return;

      const seats = this.container.querySelectorAll('.acb-seat-node');
      const seatPositions = new Map();
      const rect = this.container.getBoundingClientRect();

      seats.forEach(s => {
        const sRect = s.getBoundingClientRect();
        seatPositions.set(s.dataset.agentId, {
          x: sRect.left - rect.left + sRect.width / 2,
          y: sRect.top - rect.top + sRect.height / 2
        });
      });

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Group interactions by pair (from -> to), avoiding duplicate bundle tangle
      const pairMap = new Map();
      const recentWindow = currentMessages.slice(-20);

      recentWindow.forEach(m => {
        if (!m || !m.author) return;
        const fromId = m.author;
        let toId = null;

        if (m.reply_to_msg_id) {
          const parent = currentMessages.find(p => p.id === m.reply_to_msg_id || p.msg_id === m.reply_to_msg_id);
          if (parent && parent.author && parent.author !== fromId) {
            toId = parent.author;
          }
        }

        const pairKey = `${fromId}->${toId || 'center'}`;
        pairMap.set(pairKey, { fromId, toId, lastMsg: m });
      });

      // Filter to latest 3-4 distinct paths only
      const activePairs = Array.from(pairMap.values()).slice(-4);

      activePairs.forEach(pair => {
        const fromPos = seatPositions.get(pair.fromId);
        if (!fromPos) return;

        let toPos = pair.toId ? seatPositions.get(pair.toId) : null;
        if (!toPos) {
          toPos = { x: centerX, y: centerY };
        }

        // Quadratic Bezier curve
        const midX = (fromPos.x + toPos.x) / 2;
        const midY = (fromPos.y + toPos.y) / 2;
        const offset = 40;
        const ctrlX = midX + (fromPos.y < toPos.y ? offset : -offset);
        const ctrlY = midY - offset;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${fromPos.x} ${fromPos.y} Q ${ctrlX} ${ctrlY} ${toPos.x} ${toPos.y}`;
        path.setAttribute('d', d);

        const isConnectedToSelected = selectedAgentId
          ? (pair.fromId === selectedAgentId || pair.toId === selectedAgentId)
          : false;

        path.setAttribute('class', 'acb-flow-arc' + (isConnectedToSelected ? ' active' : ''));
        this.svgLayer.appendChild(path);
      });
    }

    setMode(mode) {
      if (!['timeline', '3d', 'split'].includes(mode)) return;
      currentMode = mode;

      document.body.classList.remove('view-mode-timeline', 'view-mode-3d', 'view-mode-split');
      document.body.classList.add(`view-mode-${mode}`);

      // Update segmented button UI
      const btnTimeline = document.getElementById('view-mode-timeline-btn');
      const btn3D = document.getElementById('view-mode-3d-btn');
      const btnSplit = document.getElementById('view-mode-split-btn');

      [btnTimeline, btn3D, btnSplit].forEach(btn => {
        if (!btn) return;
        const isMatch = btn.dataset.viewMode === mode;
        btn.classList.toggle('active', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      const arena = this.container || document.getElementById('acb-3d-arena');
      const chatBody = document.getElementById('chat-body');
      const stageWrap = document.getElementById('workspace-stage') || document.getElementById('messages-wrap');

      const applyLayout = () => {
        if (mode === 'timeline') {
          isFrozen = true;
          if (arena) arena.style.display = 'none';
          if (chatBody) chatBody.style.display = 'flex';
          this.closeInspector();
        } else if (mode === '3d') {
          isFrozen = false;
          if (arena) arena.style.display = 'flex';
          if (chatBody) chatBody.style.display = 'none';
          this.init();
          setTimeout(() => this.render(), 30);
        } else if (mode === 'split') {
          isFrozen = false;
          if (arena) arena.style.display = 'flex';
          if (chatBody) chatBody.style.display = 'flex';
          this.init();
          setTimeout(() => this.render(), 30);
        }
      };

      if (window.AcbAnimations && typeof window.AcbAnimations.animateViewTransition === 'function' && stageWrap) {
        window.AcbAnimations.animateViewTransition(stageWrap, applyLayout, () => {
          window.dispatchEvent(new Event('resize'));
        });
      } else {
        applyLayout();
        window.dispatchEvent(new Event('resize'));
      }
    }
  }

  window.Acb3DArena = new Acb3DArena();

  document.addEventListener('DOMContentLoaded', () => {
    window.Acb3DArena.init();
  });
})();
