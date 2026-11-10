/**
 * AgentChatBus - Unified Agent Avatar & Identity System (Rework V2)
 * Single Source of Truth for 3D Chibi Models, 2D WebP Thumbnails,
 * Canonical Agent Bindings Persistence, and Honest Status Semantics.
 */

(function (window) {
  'use strict';

  const STORAGE_KEY_BINDINGS = 'acb_agent_avatar_bindings';
  const STORAGE_KEY_PREFERENCE = 'acb_user_avatar_preference';

  const CANONICAL_AGENTS = {
    'abab3492-1635-4ed0-9b56-111367eff554': {
      id: 'abab3492-1635-4ed0-9b56-111367eff554',
      canonicalName: 'Codex',
      defaultAvatar: 'codex',
      aliases: ['codex', 'codex bolt', 'codex-adapter']
    },
    'dcbc38d2-d526-41c8-8327-c31805a090a2': {
      id: 'dcbc38d2-d526-41c8-8327-c31805a090a2',
      canonicalName: 'Antigravity',
      defaultAvatar: 'antigravity',
      aliases: ['antigravity', 'antigravity desktop']
    },
    'b2636e9b-6002-436b-9f13-853785924848': {
      id: 'b2636e9b-6002-436b-9f13-853785924848',
      canonicalName: 'OpenCode',
      defaultAvatar: 'opencode',
      aliases: ['opencode', 'opencode desktop']
    },
    '42f39694-4517-4583-8b6b-96267c907158': {
      id: '42f39694-4517-4583-8b6b-96267c907158',
      canonicalName: 'Muse',
      defaultAvatar: 'marley',
      aliases: ['muse', 'marley', 'muse · marley', 'browser agent (muse)']
    }
  };

  const AVATAR_MODELS = {
    codex: {
      key: 'codex',
      name: 'Codex Bolt ⚡',
      canonicalName: 'Codex',
      defaultAgentId: 'abab3492-1635-4ed0-9b56-111367eff554',
      emoji: '⚡',
      bgColor: '#2b4a7a',
      desc: '深蓝闪电机器人 · 发光蓝眼睛 · 额头黄色闪电 · 天线光球',
      glb: '/static/assets/avatars/codex-bolt-3d-chibi-head.glb',
      glbSha256: '7cadfea366da460d86e95f9baad30df445e54e13a06b87db99efccd3a63b8d45',
      glbSize: 334668,
      glbMeshes: 10,
      webp: '/static/assets/avatars/codex-bolt-3d-chibi-head.webp',
      webpSha256: 'bf1da2140035f83edacdd7165ea56ed305cc09fb389ab5b3a3448fc6ee67a073',
      webpSize: 272722,
      camera: { fov: 40, position: [0, 0.45, 6.2], target: [0, 0.25, 0] }
    },
    antigravity: {
      key: 'antigravity',
      name: 'Antigravity 🍩',
      canonicalName: 'Antigravity',
      defaultAgentId: 'dcbc38d2-d526-41c8-8327-c31805a090a2',
      emoji: '🍩',
      bgColor: '#d96a7a',
      desc: '粉色甜甜圈发顶 · 彩色糖针 · 粉白卫衣 · 胸口小甜甜圈',
      glb: '/static/assets/avatars/antigravity-3d-chibi-head.glb',
      glbSha256: 'e5d84bedf34019bc901c78885ee5e1be4dc9b1dd4a190c54b1133498dd6bc457',
      glbSize: 696660,
      glbMeshes: 39,
      webp: '/static/assets/avatars/antigravity-3d-chibi-head.webp',
      webpSha256: '392941b6e795c84e661df78f65c2f8da78b3b3d70fd5c9abe6ff5f411d9d8fb4',
      webpSize: 253362,
      camera: { fov: 40, position: [0, 0.45, 6.2], target: [0, 0.25, 0] }
    },
    opencode: {
      key: 'opencode',
      name: 'OpenCode 🍉',
      canonicalName: 'OpenCode',
      defaultAgentId: 'b2636e9b-6002-436b-9f13-853785924848',
      emoji: '🍉',
      bgColor: '#2f9e4f',
      desc: '西瓜皮条纹帽 · 绿红西瓜夹克 · 胸口 {} 代码徽章',
      glb: '/static/assets/avatars/opencode-3d-chibi-head.glb',
      glbSha256: 'e63482e12c1c25626991baa1f48c75c2d409a6267484ababb7a64c7a413e227a',
      glbSize: 495652,
      glbMeshes: 18,
      webp: '/static/assets/avatars/opencode-3d-chibi-head.webp',
      webpSha256: 'da476f37761c8f0f1fb87a9cb05a9eb9bcea5936a0362143300363238a6cc261',
      webpSize: 212616,
      camera: { fov: 40, position: [0, 0.45, 6.2], target: [0, 0.25, 0] }
    },
    marley: {
      key: 'marley',
      name: 'Muse · Marley 🍍',
      canonicalName: 'Muse',
      defaultAgentId: '42f39694-4517-4583-8b6b-96267c907158',
      emoji: '🍍',
      bgColor: '#4f9a94',
      desc: '仙侠风少年 · 灰发束发带 · 灰蓝长袍水墨纹 · 金色小菠萝徽章',
      glb: '/static/assets/avatars/muse-marley-3d-chibi-head.glb',
      glbSha256: '68e3cfdfedb049b059c08e47d5dc32c84ae06ddbb431fd204bd73b6752d826cc',
      glbSize: 783264,
      glbMeshes: 15,
      webp: '/static/assets/avatars/muse-marley-3d-chibi-head.webp',
      webpSha256: 'ea2cbf1c3073027cbf7f6f8b7cd920afe2e93d0fc147b9c873b103d629d710aa',
      webpSize: 313486,
      camera: { fov: 40, position: [0, 0.45, 6.2], target: [0, 0.25, 0] }
    }
  };

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getStoredBindings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BINDINGS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch (_) {
      return {};
    }
  }

  function saveStoredBindings(bindings) {
    try {
      localStorage.setItem(STORAGE_KEY_BINDINGS, JSON.stringify(bindings || {}));
      try {
        window.dispatchEvent(new CustomEvent('acb-avatar-bindings-changed', { detail: bindings }));
      } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[AcbAvatarSystem] Failed to save bindings to localStorage:', e);
      return false;
    }
  }

  function findCanonicalAgentId(id, name) {
    const sId = String(id || '').trim().toLowerCase();
    const sName = String(name || '').trim().toLowerCase();

    // If explicit ID is provided: only match canonical IDs or exact authorized aliases
    if (sId) {
      if (CANONICAL_AGENTS[sId]) return sId;
      for (const [canonicalId, cfg] of Object.entries(CANONICAL_AGENTS)) {
        if (sId === canonicalId.toLowerCase()) return canonicalId;
        if (cfg.aliases && cfg.aliases.some(a => sId === a.toLowerCase())) {
          return canonicalId;
        }
      }
      // Non-canonical independent ID: strictly preserve identity, never hijack by name!
      return null;
    }

    // Only if no ID was provided at all, allow exact name match against canonical name or aliases
    if (sName) {
      for (const [canonicalId, cfg] of Object.entries(CANONICAL_AGENTS)) {
        if (sName === cfg.canonicalName.toLowerCase()) return canonicalId;
        if (cfg.aliases && cfg.aliases.some(a => sName === a.toLowerCase())) {
          return canonicalId;
        }
      }
    }

    return null;
  }

  function checkIsWebSession(agent) {
    if (!agent) return false;
    const name = String(agent.name || agent.display_name || agent.author || '').toLowerCase();
    const client = String(agent.client_type || agent.type || agent.connection_type || '').toLowerCase();
    const id = String(agent.id || agent.agent_id || '').toLowerCase();
    const caps = Array.isArray(agent.capabilities) ? agent.capabilities : [];

    return (
      agent.is_web === true ||
      agent.is_browser === true ||
      client === 'browser' ||
      name.includes('browser') ||
      name.includes('网页会话') ||
      id.startsWith('browser_') ||
      caps.includes('browser-ui') ||
      caps.includes('web-session-presence')
    );
  }

  const AcbAvatarSystem = {
    manifest: AVATAR_MODELS,
    canonicalAgents: CANONICAL_AGENTS,
    escapeHtml,

    getModel(key) {
      return AVATAR_MODELS[key] || null;
    },

    getAllModels() {
      return Object.values(AVATAR_MODELS);
    },

    getCanonicalAgentsList() {
      return Object.values(CANONICAL_AGENTS);
    },

    getBindings() {
      return getStoredBindings();
    },

    setAgentAvatarBinding(canonicalAgentId, avatarKey) {
      if (!canonicalAgentId) {
        console.warn('[AcbAvatarSystem] Cannot set avatar binding without canonicalAgentId');
        return false;
      }
      if (!AVATAR_MODELS[avatarKey]) {
        console.warn(`[AcbAvatarSystem] Unknown avatar key: ${avatarKey}`);
        return false;
      }
      const bindings = getStoredBindings();
      bindings[canonicalAgentId] = avatarKey;
      return saveStoredBindings(bindings);
    },

    clearAgentAvatarBinding(canonicalAgentId) {
      if (!canonicalAgentId) return false;
      const bindings = getStoredBindings();
      delete bindings[canonicalAgentId];
      return saveStoredBindings(bindings);
    },

    resolveAgentAvatar(agentOrId, optionalName) {
      let id = '';
      let name = '';
      let isWeb = false;
      let rawObj = null;

      if (typeof agentOrId === 'object' && agentOrId !== null) {
        rawObj = agentOrId;
        id = agentOrId.id || agentOrId.agent_id || '';
        name = agentOrId.name || agentOrId.display_name || agentOrId.author || '';
        isWeb = checkIsWebSession(agentOrId);
      } else {
        id = String(agentOrId || '');
        name = String(optionalName || '');
        isWeb = name.toLowerCase().includes('browser') || id.toLowerCase().startsWith('browser_');
      }

      const canonicalId = findCanonicalAgentId(id, name);
      const bindings = getStoredBindings();

      let activeModelKey = null;
      if (canonicalId) {
        // User custom binding takes highest priority
        if (bindings[canonicalId] && AVATAR_MODELS[bindings[canonicalId]]) {
          activeModelKey = bindings[canonicalId];
        } else {
          // Default canonical model
          activeModelKey = CANONICAL_AGENTS[canonicalId].defaultAvatar;
        }
      }

      if (activeModelKey && AVATAR_MODELS[activeModelKey]) {
        const model = AVATAR_MODELS[activeModelKey];
        const canonicalCfg = canonicalId ? CANONICAL_AGENTS[canonicalId] : null;
        return {
          ...model,
          canonicalAgentId: canonicalId,
          canonicalName: canonicalCfg ? canonicalCfg.canonicalName : model.canonicalName,
          displayName: name || (canonicalCfg ? canonicalCfg.canonicalName : model.canonicalName),
          isWebSession: isWeb,
          badgeText: isWeb ? '网页会话' : null
        };
      }

      // Non-canonical agent or Human
      const isHuman = name.toLowerCase().includes('human') || name.toLowerCase().includes('user') || id.toLowerCase() === 'human';
      const cleanName = String(name || '').trim();
      const firstChar = cleanName ? cleanName.slice(0, 1) : '';
      const isValidChar = /^[a-zA-Z0-9\u4e00-\u9fa5]/.test(firstChar);
      const fallbackInitial = isValidChar ? firstChar.toUpperCase() : '🤖';
      const safeDisplayName = cleanName || (id ? id.slice(0, 8) : 'Agent');

      return {
        key: 'custom',
        name: safeDisplayName,
        displayName: safeDisplayName,
        canonicalAgentId: null,
        canonicalName: safeDisplayName,
        emoji: isHuman ? '👤' : (isWeb ? '🌐' : fallbackInitial),
        bgColor: '#334155',
        desc: '标准外部席位',
        glb: null,
        webp: null,
        isWebSession: isWeb,
        badgeText: isWeb ? '网页会话' : null
      };
    },

    renderAvatarHtml(agentInfo, size = 'md', isOnline = true) {
      const avatar = this.resolveAgentAvatar(agentInfo);
      const safeTitle = escapeHtml(avatar.displayName + (avatar.isWebSession ? ' (网页会话)' : ''));
      const safeAlt = escapeHtml(avatar.displayName);

      // Honest status semantics:
      // If offline -> always offline (gray), never misleadingly show active browser blue dot!
      // If online -> if web session -> browser (cyan); if standard agent -> online (green)
      const dotState = !isOnline ? 'offline' : (avatar.isWebSession ? 'browser' : 'online');
      const stateAttr = !isOnline ? 'offline' : (avatar.isWebSession ? 'browser_session' : 'online');

      let inner = '';
      if (avatar.webp) {
        inner = `<img class="acb-avatar__img" src="${escapeHtml(avatar.webp)}" alt="${safeAlt}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="acb-avatar__glyph" style="display:none;">${escapeHtml(avatar.emoji)}</span>`;
      } else {
        inner = `<span class="acb-avatar__glyph">${escapeHtml(avatar.emoji)}</span>`;
      }

      return `<div class="acb-avatar acb-avatar--${size}" data-state="${stateAttr}" title="${safeTitle}">
        ${inner}
        <span class="acb-avatar-dot acb-avatar-dot--${dotState}" data-state="${dotState}"></span>
      </div>`;
    }
  };

  window.AcbAvatarSystem = AcbAvatarSystem;
})(window);
