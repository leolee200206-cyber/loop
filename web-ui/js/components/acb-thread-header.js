(function registerAcbThreadHeader() {
  class AcbThreadHeader extends HTMLElement {
    connectedCallback() {
      if (this.childElementCount > 0) return;

      this.innerHTML = [
        '<div id="thread-header" style="display:none">',
        '  <div class="thread-header__title-stack">',
        '    <h2 id="thread-title"></h2>',
        '    <div class="thread-header__meta-row">',
        '      <div id="thread-admin-label" class="thread-header__admin" hidden></div>',
        '      <div id="thread-participants-roster" class="thread-participants-roster" title="查看参与者详情" onclick="window.Acb3DArena && window.Acb3DArena.openRosterDrawer && window.Acb3DArena.openRosterDrawer()">',
        '        <span class="roster-avatars" id="roster-avatars"></span>',
        '        <span id="roster-count-text"></span>',
        '      </div>',
        '    </div>',
        '  </div>',
        '',
        '  <!-- Single primary view segmented switcher -->',
        '  <div class="acb-view-segmented" role="tablist" aria-label="视图模式">',
        '    <button id="view-mode-timeline-btn" class="acb-segmented-item active" data-view-mode="timeline" type="button" role="tab" aria-selected="true" title="经典时间线对话流" onclick="window.Acb3DArena && window.Acb3DArena.setMode(\'timeline\')">',
        '      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        '      <span>时间线</span>',
        '    </button>',
        '    <button id="view-mode-3d-btn" class="acb-segmented-item" data-view-mode="3d" type="button" role="tab" aria-selected="false" title="3D 空间席位与流向" onclick="window.Acb3DArena && window.Acb3DArena.setMode(\'3d\')">',
        '      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        '      <span>3D 空间</span>',
        '    </button>',
        '    <button id="view-mode-split-btn" class="acb-segmented-item" data-view-mode="split" type="button" role="tab" aria-selected="false" title="左右分屏并览模式" onclick="window.Acb3DArena && window.Acb3DArena.setMode(\'split\')">',
        '      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',
        '      <span>分屏并览</span>',
        '    </button>',
        '  </div>',
        '',
        '  <!-- Secondary actions & More dropdown (BUG-01: unified .thread-header__actions) -->',
        '  <div class="thread-header__actions" style="display:flex;gap:6px;align-items:center;">',
        '    <button id="search-toggle-btn" class="header-icon-btn" type="button" title="搜索消息 (Ctrl+F)" aria-label="搜索消息" onclick="window.AcbSearch && window.AcbSearch.toggle()">',
        '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        '      </svg>',
        '    </button>',
        '    <button id="avatar-3d-btn" class="header-icon-btn" type="button" title="3D 虚拟形象设置" aria-label="3D 虚拟形象设置" onclick="window.AcbAvatarViewer && window.AcbAvatarViewer.open()">',
        '      <span style="font-size:14px;line-height:1;">🎭</span>',
        '    </button>',
        '',
        '    <!-- More Menu Dropdown -->',
        '    <div class="acb-header-dropdown">',
        '      <button id="header-more-btn" class="header-icon-btn" type="button" title="更多操作" aria-label="更多操作" onclick="window.toggleHeaderMoreMenu(event)">',
        '        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '          <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
        '        </svg>',
        '      </button>',
        '      <div id="header-more-dropdown" class="acb-dropdown-menu">',
        '        <button type="button" class="acb-dropdown-item" onclick="window.AcbAvatarViewer && window.AcbAvatarViewer.open(); window.closeHeaderMoreMenu();">',
        '          <span style="font-size:13px;line-height:1;">🎭</span>',
        '          <span>3D 虚拟形象设置</span>',
        '        </button>',
        '        <button type="button" class="acb-dropdown-item" onclick="window.AcbCliSessions && window.AcbCliSessions.toggleTerminalVisibility(); window.closeHeaderMoreMenu();">',
        '          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        '          <span>智能体终端面板</span>',
        '        </button>',
        '        <button type="button" class="acb-dropdown-item" onclick="window.openAddAgentModal && window.openAddAgentModal(); window.closeHeaderMoreMenu();">',
        '          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
        '          <span>添加智能体</span>',
        '        </button>',
        '        <button type="button" class="acb-dropdown-item" onclick="window.openRestartThreadModal && window.openRestartThreadModal(); window.closeHeaderMoreMenu();">',
        '          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15A9 9 0 1 1 23 10"/></svg>',
        '          <span>重启此线程</span>',
        '        </button>',
        '        <button type="button" class="acb-dropdown-item" onclick="window.exportFromHeader && window.exportFromHeader(); window.closeHeaderMoreMenu();">',
        '          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        '          <span>导出为 Markdown</span>',
        '        </button>',
        '        <button type="button" class="acb-dropdown-item" onclick="window.openThreadSettingsModal && window.openThreadSettingsModal(); window.closeHeaderMoreMenu();">',
        '          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        '          <span>线程设置</span>',
        '        </button>',
        '      </div>',
        '    </div>',
        '',
        '    <!-- Legacy online-presence preserved for compatibility but visually hidden -->',
        '    <div id="online-presence" style="display:none"><span id="online-count">0</span></div>',
        '  </div>',
        '</div>'
      ].join('\n');

      window.toggleHeaderMoreMenu = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const menu = document.getElementById('header-more-dropdown');
        if (menu) {
          menu.classList.toggle('visible');
        }
      };

      window.closeHeaderMoreMenu = function() {
        const menu = document.getElementById('header-more-dropdown');
        if (menu) {
          menu.classList.remove('visible');
        }
      };

      document.addEventListener('click', () => {
        window.closeHeaderMoreMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          window.closeHeaderMoreMenu();
        }
      });
    }
  }

  if (!customElements.get('acb-thread-header')) {
    customElements.define('acb-thread-header', AcbThreadHeader);
  }
})();
