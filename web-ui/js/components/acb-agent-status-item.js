(function () {
  class AcbAgentStatusItem extends HTMLElement {
    constructor() {
      super();
      this._data = null;
    }

    connectedCallback() {
      this._onBindingsChanged = () => this._render();
      window.addEventListener("acb-avatar-bindings-changed", this._onBindingsChanged);
      this._render();
    }

    disconnectedCallback() {
      if (this._onBindingsChanged) {
        window.removeEventListener("acb-avatar-bindings-changed", this._onBindingsChanged);
        this._onBindingsChanged = null;
      }
    }

    setData(data) {
      this._data = data || null;
      this._render();
    }

    _render() {
      if (!this._data) return;

      const {
        avatarEmoji,
        label,
        state,
        stateText,
        isAdministrator,
        offlineDisplay,
        isLongOffline,
        compressedChar,
        escapeHtml,
        skills,
        stateEmoji,
        isStdio,
        isWebSession,
        sessionType,
        tooltipText,
      } = this._data;

      const esc = typeof escapeHtml === "function" ? escapeHtml : (v) => String(v ?? "");
      const stateLower = String(state ?? "").trim().toLowerCase();
      const resolvedStateText = String(stateText ?? state ?? "").trim();

      const isDarkTheme = document.body.getAttribute('data-theme') !== 'light';
      const styles = window.AcbUtils ? window.AcbUtils.getEmojiStyledBackground(avatarEmoji, isDarkTheme) : { bg: 'transparent', border: 'transparent' };
      const avatarBg = styles.bg;
      const avatarBorder = styles.border;

      const isOffline = stateLower === "offline" || stateLower === "disconnected";
      const resolvedSessionType = isWebSession ? "browser" : (sessionType || (isStdio ? "stdio" : "sse"));

      const agentId = (this._data && this._data.id) || this.dataset?.agentId || this.getAttribute('data-agent-id') || '';
      const resolvedAvatar = window.AcbAvatarSystem ? window.AcbAvatarSystem.resolveAgentAvatar({ id: agentId, name: label, emoji: avatarEmoji, is_web: isWebSession }) : null;
      let avatarContent = avatarEmoji;
      if (resolvedAvatar && resolvedAvatar.webp) {
        avatarContent = `<img src="${resolvedAvatar.webp}" alt="${esc(label)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;pointer-events:none;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" /><span style="display:none;">${avatarEmoji}</span>`;
      }

      this.className = "agent-status-item";
      this.dataset.state = isOffline ? "offline" : stateLower;
      this.dataset.sessionType = resolvedSessionType;

      const dotState = isOffline
        ? "offline"
        : (isWebSession ? "browser" : "online");

      const targetAgentId = (resolvedAvatar && resolvedAvatar.canonicalAgentId) || agentId;

      // Long-offline compact mode (>1hr offline)
      if (isLongOffline) {
        const compactTitle = compressedChar === "∞"
          ? "Offline since unknown time"
          : `Offline ${offlineDisplay || compressedChar}`;
        this.innerHTML = `
          <div class="agent-status-item agent-status-item--compact" title="${esc(compactTitle)}">
            <div class="asi-avatar-wrap asi-avatar-wrap--compact" ${resolvedAvatar?.key && resolvedAvatar.key !== 'custom' ? `onclick="window.AcbAvatarViewer && window.AcbAvatarViewer.open('${resolvedAvatar.key}', '${targetAgentId}')" style="cursor:pointer;" title="点击查看 3D 虚拟形象"` : ''}>
              <div class="asi-avatar asi-avatar--sm" style="background:${avatarBg}; border: 1px solid ${avatarBorder};">${avatarContent}</div>
              <span class="acb-avatar-dot acb-avatar-dot--offline" style="width:6px;height:6px;bottom:-1px;right:-1px;"></span>
              ${isAdministrator ? '<span class="asi-admin-badge" aria-label="Administrator">👑</span>' : ''}
            </div>
            <span class="asi-state-emoji">${stateEmoji}</span>
          </div>
        `;
        return;
      }

      // Normal card: 48x48 avatar on left, 24x48 status panel on right
      const transportIcon = isOffline
        ? `<span class="asi-transport-emoji">❔</span>`
        : isWebSession
          ? `<span class="asi-transport-emoji" title="Web Session">🌐</span>`
          : isStdio
            ? `<span class="asi-transport-emoji" title="Stdio Connection">✡️</span>`
            : `<span class="asi-transport-emoji" title="SSE Connection">🌟</span>`;

      const transportTooltip = isOffline
        ? 'Connection unknown'
        : isWebSession
          ? 'Browser web session (online does not indicate model execution)'
          : isStdio
            ? 'Stdio connection'
            : 'SSE connection';

      this.innerHTML = `
        <div class="asi-avatar-wrap" ${resolvedAvatar?.key && resolvedAvatar.key !== 'custom' ? `onclick="window.AcbAvatarViewer && window.AcbAvatarViewer.open('${resolvedAvatar.key}', '${resolvedAvatar?.canonicalAgentId || agentId}')" style="cursor:pointer;" title="点击查看 3D 虚拟形象"` : ''}>
          <div class="asi-avatar" style="background:${avatarBg}; border: 1px solid ${avatarBorder};" data-tooltip="${esc(tooltipText || resolvedStateText || state)}">${avatarContent}</div>
          <span class="acb-avatar-dot acb-avatar-dot--${dotState}" data-state="${dotState}"></span>
          ${isAdministrator ? '<span class="asi-admin-badge" aria-label="Administrator">👑</span>' : ''}
        </div>
        <div class="asi-status-panel">
          <div class="asi-status-box" data-tooltip="${esc(resolvedStateText || state || 'unknown')}">${stateEmoji}</div>
          <div class="asi-transport-box" data-tooltip="${esc(transportTooltip)}">${transportIcon}</div>
        </div>
      `;

      // Remove all tooltip attributes from the card element itself so closest()
      // doesn't short-circuit to the card before reaching the child boxes.
      this.removeAttribute("title");
      this.removeAttribute("data-tooltip");
      this.removeAttribute("data-acb-tooltip");
    }
  }

  if (!customElements.get("acb-agent-status-item")) {
    customElements.define("acb-agent-status-item", AcbAgentStatusItem);
  }
})();
