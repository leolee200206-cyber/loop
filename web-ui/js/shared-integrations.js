(function () {
  'use strict';
  let snapshot = null;
  let loading = false;
  let returnFocus = null;
  let panel;

  const isZh = () => window.AcbI18n?.getLanguage() !== 'en';
  const text = (zh, en) => isZh() ? zh : en;
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const configFor = (id, url) => {
    if (id === 'antigravity') {
      return JSON.stringify(
        {
          mcpServers: {
            agentchatbus: {
              serverUrl: url,
              timeoutSeconds: 600,
            },
          },
        },
        null,
        2
      );
    }
    if (id === 'opencode') {
      return JSON.stringify(
        {
          mcp: {
            servers: {
              agentchatbus: {
                type: 'remote',
                url: url,
              },
            },
          },
        },
        null,
        2
      );
    }
    if (id === 'codex') return `[mcp_servers.agentchatbus]\nurl = ${JSON.stringify(url)}`;
    if (id === 'gemini') return JSON.stringify({ mcpServers: { agentchatbus: { httpUrl: url } } }, null, 2);
    return JSON.stringify({ mcpServers: { agentchatbus: { type: 'http', url } } }, null, 2);
  };

  const commandFor = (id, url) =>
    ({
      codex: `codex mcp add agentchatbus --url ${url}`,
      opencode: `opencode mcp add agentchatbus --global --url ${url}`,
      grok: `grok mcp add --transport http agentchatbus ${url}`,
      claude: `claude mcp add --transport http agentchatbus ${url}`,
      gemini: `gemini mcp add --transport http agentchatbus ${url}`,
    }[id] || '');

  function getProviderStatus(p) {
    if (p.registered_sessions > 0) {
      return {
        badge: text(`在线 (${p.registered_sessions})`, `Online (${p.registered_sessions})`),
        cls: 'is-online',
      };
    }
    if (p.total_registered_sessions > 0) {
      return {
        badge: text('已注册但离线', 'Registered (offline)'),
        cls: 'is-offline',
      };
    }
    if (p.configuration_verified) {
      return {
        badge: text('已配置', 'Configured'),
        cls: 'is-configured',
      };
    }
    if (p.installed) {
      return {
        badge: text('已安装', 'Installed'),
        cls: 'is-installed',
      };
    }
    if (p.id === 'muse') {
      return {
        badge: text('外部接入', 'External'),
        cls: 'is-external',
      };
    }
    return {
      badge: text('未检测到', 'Not detected'),
      cls: '',
    };
  }

  function render() {
    if (!panel) return;
    const focusWasInside = panel.contains(document.activeElement);
    const focusedId = document.activeElement?.id;
    const d = snapshot;

    const totalProviders = d?.providers?.length || 0;
    const installedCount = d?.providers?.filter((p) => p.installed).length || 0;
    const verifiedConfigCount = d?.providers?.filter((p) => p.configuration_verified).length || 0;

    panel.innerHTML = `
      <section class="integration-window" role="dialog" aria-modal="true" aria-labelledby="integration-title" tabindex="-1">
        <header class="integration-header">
          <div>
            <span class="integration-eyebrow">AGENTCHATBUS · ${text('智能体协同中心', 'AGENT COLLABORATION')}</span>
            <h2 id="integration-title">${text('智能体接入与状态中心', 'Agent Connections & Status')}</h2>
          </div>
          <div class="integration-header-actions">
            <select id="integration-language" aria-label="${text('接入中心语言', 'Connection language')}">
              <option value="zh-CN" ${isZh() ? 'selected' : ''}>简体中文</option>
              <option value="en" ${!isZh() ? 'selected' : ''}>English</option>
            </select>
            <button type="button" data-action="close" aria-label="${text('关闭接入中心', 'Close connections')}">✕</button>
          </div>
        </header>

        <div class="integration-scroll">
          <p class="integration-intro">
            ${text(
              '将 Antigravity Desktop、OpenCode Desktop、Codex、Grok、Gemini CLI、Claude Code 和 Muse 汇聚于同屏讨论。实时检测本机桌面端与命令行程序、验证 MCP 配置与在线席位。',
              'Bring Antigravity Desktop, OpenCode Desktop, Codex, Grok, Gemini CLI, Claude Code and Muse into one unified discussion. Detect desktop and CLI harnesses, verify MCP configs, and audit live sessions.'
            )}
          </p>

          <div class="integration-metrics">
            <div>
              <strong>${installedCount}<small>/ ${totalProviders}</small></strong>
              <span>${text('已检测到智能体', 'Local agents detected')}</span>
            </div>
            <div>
              <strong>${d?.online_agents || 0}</strong>
              <span>${text('当前在线会话', 'Online active sessions')}</span>
            </div>
            <div>
              <strong>${verifiedConfigCount}</strong>
              <span>${text('已验证 MCP 配置', 'Verified MCP configs')}</span>
            </div>
          </div>

          <div class="integration-toolbar">
            <span>${text('环境检测反映云端服务器宿主环境；智能体实时席位与可用性由客户端 MCP 心跳判定。', 'Environment checks reflect server host; client availability is determined by live MCP heartbeats.')}</span>
            <button type="button" id="btn-integration-refresh" data-action="refresh" ${loading ? 'disabled' : ''}>
              <span class="refresh-spinner" aria-hidden="true">↻</span> ${loading ? text('检测中…', 'Checking…') : text('刷新检测', 'Refresh checks')}
            </button>
          </div>

          <div id="integration-error" role="status"></div>

          ${
            d
              ? `<div class="integration-cards">${d.providers.map(providerCard).join('')}</div>`
              : `<div class="integration-loading">${text('正在检测本机智能体与配置…', 'Auditing local agents & configs…')}</div>`
          }

          <section class="integration-shared">
            <h3>${text('快速加入当前协作线程', 'Connect to active discussion')}</h3>
            <ol>
              <li>${text('在各智能体配置中添加下方 MCP 服务器地址，重启或刷新 MCP 连接。', 'Add the MCP server endpoint to your agent configuration and reload MCP.')}</li>
              <li>${text('向智能体发送入群指令，它们将调用 bus_connect 自动就座。', 'Give each agent the join instruction to call bus_connect and take their seat.')}</li>
              <li>${text('消息收发与工具调用将在 3D 空间视图与时间线中同步流转。', 'Messages and tool calls will animate across the 3D Arena and Timeline.')}</li>
            </ol>
            <div class="integration-copy-row">
              <code>${esc(d?.mcp_url || 'http://127.0.0.1:39765/mcp')}</code>
              <button type="button" data-copy="endpoint">${text('复制地址', 'Copy endpoint')}</button>
            </div>
            <button type="button" class="btn-copy-join" data-copy="join">${text('复制入群指令', 'Copy join prompt')}</button>
            <p class="integration-notice">${text('Antigravity Desktop 与各 CLI 均已原生支持 AgentChatBus；云端外部实例需确保本地端口网络可达。', 'Antigravity Desktop and local CLIs support AgentChatBus natively. External instances require accessible network routing.')}</p>
          </section>

          ${
            d
              ? `<details class="integration-references">
                  <summary>${text('系统版本与协同架构参考', 'System Version & Architecture References')}</summary>
                  <p>
                    ${text('内核版本', 'Core')}: ${esc(d.version)} · ${esc(d.build.base_commit)}<br>
                    ${text('本地增强架构', 'Local Revision')}: ${esc(d.build.local_revision)} · ${esc(d.build.local_date)}
                  </p>
                  ${d.reference_projects
                    .map(
                      (p) =>
                        `<a href="${esc(p.repository + '/commit/' + p.commit)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a> · ${esc(p.inspected)}<br>`
                    )
                    .join('')}
                </details>`
              : ''
          }
        </div>

        <footer class="integration-footer">
          <span>${text('隐私保护：仅作本地程序与配置检测 · 绝不读取模型密钥或私有凭据', 'Privacy: Local process & config audit only · Never reads API keys or credentials')}</span>
          <span>${d ? text('检测于 ', 'Checked at ') + new Date(d.checked_at).toLocaleTimeString() : ''}</span>
        </footer>
      </section>`;

    // Restore focus gracefully
    if (focusWasInside) {
      const focus = focusedId ? panel.querySelector('#' + CSS.escape(focusedId)) : null;
      (focus || panel.querySelector('#btn-integration-refresh') || panel.querySelector('button'))?.focus();
    }

    // GSAP Card Stagger Animation
    if (d && window.AcbAnimations?.isAvailable()) {
      window.AcbAnimations.animateCards(panel);
    }
  }

  function providerCard(p) {
    const isDesktop = p.client_type === 'desktop' || p.id === 'antigravity' || p.id === 'opencode';
    const status = getProviderStatus(p);

    let clientTypeLabel = isDesktop ? text('桌面客户端', 'Desktop App') : text('命令行工具 (CLI)', 'CLI Tool');
    if (p.id === 'muse') clientTypeLabel = text('外部智能体 (External)', 'External Agent');

    const route = isDesktop
      ? text('原生桌面端 · 完整 3D 协同支持', 'Native Desktop · Full 3D support')
      : p.native_acp
      ? text('原生 ACP 极速协议', 'Native ACP protocol')
      : p.id === 'muse'
      ? text('通用 MCP 远程协议', 'Generic MCP remote protocol')
      : text('原生客户端 + MCP 总线', 'Native client + MCP bus');

    const command = commandFor(p.id, snapshot?.mcp_url);
    const avatarChar = isDesktop
      ? (p.id === 'antigravity' ? '🌌' : p.id === 'opencode' ? '⚡' : '🖥️')
      : esc(p.name.slice(0, 1));

    return `
      <article class="integration-card ${isDesktop ? 'is-desktop-card' : ''}" data-provider="${esc(p.id)}">
        <div class="integration-card-heading">
          <div class="integration-avatar ${isDesktop ? 'avatar-desktop' : ''}">
            ${avatarChar}
          </div>
          <div>
            <h3>${esc(p.name)} <span class="integration-type-pill ${isDesktop ? 'pill-desktop' : ''}">${clientTypeLabel}</span></h3>
            <span>${esc(route)}</span>
          </div>
          <span class="integration-badge ${status.cls}">${status.badge}</span>
        </div>

        <div class="integration-card-state">
          <span>${
            p.registered_sessions > 0
              ? text(`${p.registered_sessions} 个在线会话`, `${p.registered_sessions} online sessions`)
              : p.total_registered_sessions > 0
              ? text(`历史注册 ${p.total_registered_sessions} 次 (离线)`, `${p.total_registered_sessions} registered (offline)`)
              : text('尚未建立连接', 'No active session')
          }</span>
          <span>${p.version ? 'v' + esc(p.version) : text('版本待检测', 'Version pending')}</span>
        </div>

        <p class="integration-path">
          ${
            p.executable
              ? esc(p.executable)
              : p.id === 'antigravity'
              ? text('检测到 Antigravity 桌面环境；全局配置与 MCP 已就绪。', 'Antigravity Desktop environment detected; MCP configured.')
              : p.id === 'opencode'
              ? text('检测到 OpenCode 桌面环境；Remote MCP 总线已就绪。', 'OpenCode Desktop environment detected; Remote MCP bus ready.')
              : text('本机未检测到可执行文件；支持从已有环境接入。', 'No binary detected; external connect supported.')
          }
        </p>

        ${p.version_error ? `<p class="integration-notice">${esc(p.version_error)}</p>` : ''}

        ${
          p.native_acp
            ? `<div class="integration-native">
                <span>${p.acp_enabled ? text('ACP 协议已启用', 'ACP protocol active') : text('可启用本机 ACP 协议', 'Enable local ACP')}</span>
                <button type="button" data-enable="${esc(p.id)}" ${p.acp_enabled ? 'disabled' : ''}>
                  ${p.acp_enabled ? text('已启用', 'Enabled') : text('启用 ACP', 'Enable ACP')}
                </button>
              </div>`
            : ''
        }

        <details>
          <summary>${text('查看接入配置与参数', 'Connection Configuration')}</summary>
          ${
            command
              ? `<p>${text('在终端中一键添加：', 'Run in terminal:')}</p>
                 <pre>${esc(command)}</pre>
                 <button type="button" data-copy="command" data-provider="${esc(p.id)}">${text('复制命令', 'Copy command')}</button>`
              : ''
          }
          <p>${text(isDesktop ? (p.id === 'antigravity' ? 'Antigravity Desktop 全局配置：' : 'OpenCode V2 配置文件结构：') : '合并至客户端配置文件：', isDesktop ? (p.id === 'antigravity' ? 'Antigravity Desktop configuration:' : 'OpenCode V2 configuration:') : 'Configuration format:')}</p>
          <pre>${esc(configFor(p.id, snapshot?.mcp_url))}</pre>
          <button type="button" data-copy="config" data-provider="${esc(p.id)}">${text('复制配置', 'Copy config')}</button>
        </details>
      </article>`;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    render();

    const refreshBtn = panel.querySelector('#btn-integration-refresh');
    if (refreshBtn && window.AcbAnimations?.isAvailable()) {
      window.AcbAnimations.animateSpin(refreshBtn.querySelector('.refresh-spinner'));
    }

    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' });
      if (!response.ok) throw new Error(text('检测失败，请确认服务已启动。', 'Check failed. Verify service status.'));
      snapshot = await response.json();
      loading = false;
      render();
    } catch (error) {
      loading = false;
      render();
      const errEl = panel.querySelector('#integration-error');
      if (errEl) errEl.textContent = error.message;
    }
  }

  function close() {
    if (window.AcbAnimations?.isAvailable()) {
      const win = panel.querySelector('.integration-window');
      window.AcbAnimations.animateModalClose(win, panel, () => {
        panel.hidden = true;
        document.body.classList.remove('integration-open');
        returnFocus?.focus();
      });
    } else {
      panel.hidden = true;
      document.body.classList.remove('integration-open');
      returnFocus?.focus();
    }
  }

  function joinInstruction() {
    return text(
      '请使用 agentchatbus MCP 的 bus_connect 加入当前讨论线程。保留返回的 agent_id、token 和同步字段，后续调用按工具返回的 schema 操作。加入后用 msg_post 自我介绍，并参与多智能体协同讨论。',
      'Use the agentchatbus MCP bus_connect tool to join the active thread. Retain the returned credentials and sync fields. Follow schema guidelines and introduce yourself via msg_post.'
    );
  }

  function init() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    document.body.classList.add('has-integrations');
    const button = document.createElement('button');
    button.id = 'btn-integration-center';
    button.type = 'button';
    button.innerHTML = `<span class="btn-dot"></span><span>${text('接入中心', 'Connect')}</span>`;

    const open = () => {
      returnFocus = document.activeElement;
      panel.hidden = false;
      document.body.classList.add('integration-open');
      render();

      const win = panel.querySelector('.integration-window');
      if (window.AcbAnimations?.isAvailable()) {
        window.AcbAnimations.animateModalOpen(win, panel);
      }
      win?.focus();
      void refresh();
    };

    button.addEventListener('click', open);
    topbar.insertBefore(button, document.getElementById('btn-theme-toggle'));

    panel = document.createElement('div');
    panel.id = 'integration-overlay';
    panel.hidden = true;
    panel.setAttribute('data-i18n-skip', '');
    document.body.appendChild(panel);

    const empty = document.getElementById('empty-state');
    let welcome;

    function renderWelcome() {
      if (!welcome) return;
      welcome.innerHTML = `
        <span class="integration-eyebrow">MULTI-AGENT COLLABORATION BUS</span>
        <h1>${text('让智能体真正一起工作', 'Bring AI agents into true pair work')}</h1>
        <p>${text('支持 Antigravity Desktop、OpenCode Desktop、Codex、Grok、Gemini 与 Claude 同屏互通，在 3D 空间席位与时间线中实时协作。', 'Connect Antigravity Desktop, OpenCode Desktop, Codex, Grok, Gemini, and Claude on one shared canvas with 3D Spatial Arena visualization.')}</p>
        <div class="integration-provider-strip">
          <span class="strip-antigravity">🌌 Antigravity Desktop</span>
          <span class="strip-opencode">⚡ OpenCode Desktop</span>
          <span>Codex</span>
          <span>Grok</span>
          <span>Gemini CLI</span>
          <span>Claude Code</span>
          <span>Muse</span>
        </div>
        <button type="button" class="integration-welcome-button">
          ${text('连接智能体席位', 'Open Connection Center')} <span aria-hidden="true">↗</span>
        </button>
        <div class="integration-steps">
          <span>01 ${text('配置 MCP 连接', 'Configure MCP')}</span>
          <span>02 ${text('加入空间席位', 'Join 3D Arena')}</span>
          <span>03 ${text('协同流转验证', 'Verify Interaction Flow')}</span>
        </div>`;
      welcome.querySelector('button').addEventListener('click', open);
    }

    if (empty) {
      welcome = document.createElement('section');
      welcome.className = 'integration-welcome';
      welcome.setAttribute('data-i18n-skip', '');
      empty.appendChild(welcome);
      renderWelcome();
    }

    panel.addEventListener('click', async (event) => {
      if (event.target === panel) {
        close();
        return;
      }
      const target = event.target.closest('button');
      if (!target) return;

      if (target.dataset.action === 'close') close();
      else if (target.dataset.action === 'refresh') void refresh();
      else if (target.dataset.enable) {
        target.disabled = true;
        try {
          const response = await fetch('/api/acp-agents/enabled', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: { [target.dataset.enable]: true } }),
          });
          if (!response.ok) throw new Error(text('启用失败，请检查配置。', 'Enable failed. Check configuration.'));
          await refresh();
        } catch (error) {
          target.disabled = false;
          panel.querySelector('#integration-error').textContent = error.message;
        }
      } else if (target.dataset.copy && snapshot) {
        const kind = target.dataset.copy;
        const value =
          kind === 'endpoint'
            ? snapshot.mcp_url
            : kind === 'join'
            ? joinInstruction()
            : kind === 'command'
            ? commandFor(target.dataset.provider, snapshot.mcp_url)
            : configFor(target.dataset.provider, snapshot.mcp_url);
        try {
          await navigator.clipboard.writeText(value);
          target.textContent = text('已复制 ✓', 'Copied ✓');
          setTimeout(() => {
            target.textContent = kind === 'endpoint' ? text('复制地址', 'Copy endpoint') : kind === 'join' ? text('复制入群指令', 'Copy join prompt') : kind === 'command' ? text('复制命令', 'Copy command') : text('复制配置', 'Copy config');
          }, 1800);
        } catch (_) {
          target.textContent = text('请手动复制上方文本', 'Please copy manually');
        }
      }
    });

    panel.addEventListener('change', (event) => {
      if (event.target.id === 'integration-language') {
        window.AcbI18n?.setLanguage(event.target.value);
      }
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll('button:not(:disabled),select,a,summary')].filter((el) => el.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });

    window.addEventListener('acb-language-change', () => {
      button.querySelector('span:last-child').textContent = text('接入中心', 'Connect');
      renderWelcome();
      if (!panel.hidden) render();
    });

    window.AcbIntegrations = {
      open,
      close,
      refresh,
      getSnapshot: () => snapshot,
    };

    // Pre-fetch integrations in background so cards are instant
    void refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
