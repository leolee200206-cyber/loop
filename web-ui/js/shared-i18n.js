/* Local Web Console language pack. UI text only; never rewrites stored data. */
(function () {
  'use strict';
  const storageKey = 'agentchatbus-language';
  const zh = {
    'AgentChatBus Console': 'AgentChatBus 控制台',
    'Connected': '已连接', 'Disconnected': '已断开', 'Connecting': '连接中',
    'Connecting...': '连接中…', 'Reconnecting...': '重新连接中…',
    'Threads': '讨论', 'THREADS': '讨论', 'Thread': '讨论',
    '＋ New Thread': '＋ 新建讨论', 'New Thread': '新建讨论',
    'Create new thread': '新建讨论', '✦ Create New Thread': '✦ 新建讨论',
    'No thread selected': '尚未选择讨论',
    'Create or select a thread to start watching the conversation': '创建或选择一个讨论，即可查看对话',
    'No threads match current filter.': '没有符合当前筛选条件的讨论。',
    'No threads yet': '暂无讨论', 'No active agents': '暂无活跃智能体',
    'No tags yet': '暂无标签', 'Close Thread': '关闭讨论', 'Thread Closed': '讨论已关闭',
    'Thread Already Closed': '讨论已关闭', 'Compare': '对比', 'Close compare view': '关闭对比视图',
    'Toggle sidebar': '展开或收起侧栏', 'Scroll to top': '回到顶部',
    'Switch to light theme': '切换为浅色主题', 'Switch to dark theme': '切换为深色主题',
    'Switch theme': '切换主题', 'Light': '浅色', 'Dark': '深色',
    'MCP Server Settings': 'MCP 服务设置', 'Backend Engine': '后端引擎',
    'Select all': '全选', 'Normal only': '常规状态', 'Clear': '清除', 'Clear all': '全部清除',
    'Tags': '标签', 'Thread tags': '讨论标签', 'Remove tag': '移除标签',
    'discuss': '讨论中', 'implement': '实施中', 'review': '审查中',
    'done': '已完成', 'closed': '已关闭', 'archived': '已归档',
    'Search messages': '搜索消息', 'Search messages (Ctrl+F)': '搜索消息（Ctrl+F）',
    'Search messages...': '搜索消息…', 'Search...': '搜索…', 'Search in:': '搜索范围：',
    'Content': '内容', 'Author': '作者', 'Metadata': '元数据',
    'Current thread': '当前讨论', 'All threads': '所有讨论',
    'Previous match': '上一个匹配', 'Next match': '下一个匹配', 'Close search': '关闭搜索',
    'No matches': '没有匹配结果', 'No results': '没有搜索结果', 'Searching...': '搜索中…',
    'Search all threads': '搜索所有讨论',
    'Create a thread and launch one or more agent sessions into it.': '创建讨论，并在其中启动一个或多个智能体会话。',
    'Startup': '启动方式', 'Create and start agents': '创建并启动智能体',
    'Create the thread and immediately launch one or more agent sessions.': '创建讨论后，立即启动一个或多个智能体会话。',
    'Create thread only': '仅创建讨论',
    'Deprecated. Not recommended. Open an empty meeting space first and add agents later.': '旧版方式，不推荐：先创建空讨论，稍后再添加智能体。',
    'Thread Name': '讨论名称', 'Thread name': '讨论名称',
    'A short, descriptive name. A default name is generated automatically, and you can edit it any time.': '输入简短明确的名称。系统会自动生成默认名称，也可以随时修改。',
    'Collaboration Template': '协作模板', 'Stand chat': '普通聊天',
    'Working Directory': '工作目录', 'Workspace': '工作区',
    'Agents To Start': '待启动智能体', 'Count': '数量', 'Interval': '间隔',
    'Never detected': '尚未检测', 'Add Agent': '添加智能体', 'Remove Agent': '移除智能体',
    'Agents launch sequentially. The first active agent becomes the administrator, and later agents join as participants.': '智能体将依次启动。首个活跃智能体成为管理员，后续智能体以参与者身份加入。',
    'Shared Instruction': '共享指令',
    'Applies to every agent by default. Leave an individual agent override blank to use this shared instruction.': '默认应用于所有智能体。单个智能体的覆盖指令留空时，将使用此共享指令。',
    'Shared Re-entry Prompt': '共享唤醒提示词',
    'Used when the system needs to wake an agent back into the thread. Edit this here before launch if you want a custom recovery prompt.': '用于唤醒智能体并让其重新加入讨论。需要自定义恢复提示词时，可在启动前修改。',
    'Resolved Launch Prompt': '最终启动提示词', 'Resolved Re-entry Prompt': '最终唤醒提示词',
    'Launch Prompt Override For Selected Agent': '当前智能体的启动提示词覆盖',
    'Optional exact prompt override. If filled, this exact text will be sent to the selected agent instead of the auto-generated launch prompt.': '选填。填写后，将直接发送此提示词，替代自动生成的启动提示词。',
    'Create and Start First Agent': '创建并启动首个智能体', 'Create Thread': '创建讨论',
    'Launch another agent session into the current thread.': '在当前讨论中启动另一个智能体会话。',
    'Manual': '手动添加', 'Agent': '智能体', 'Agents': '智能体',
    'Model': '模型', 'Model (optional)': '模型（选填）', 'Suggestions': '建议选项',
    'Reasoning Level': '推理强度', 'Use Codex default': '使用 Codex 默认设置',
    'Minimal': '最低', 'Low': '低', 'Medium': '中', 'High': '高', 'Extra High': '最高',
    'Mode': '模式', 'ACP (Agent Client Protocol)': 'ACP（智能体客户端协议）',
    'Direct (App Server)': '直连（App Server）', 'Interactive PTY': '交互式终端（PTY）',
    'Headless JSON Resume': '无界面 JSON 恢复',
    'Display Name': '显示名称', 'Leave blank to use an automatically generated agent label.': '留空时使用自动生成的智能体名称。',
    'Emoji': '表情符号', 'Initial Instruction': '初始指令',
    'New agents join as participants unless they are the first active agent in the thread.': '新智能体以参与者身份加入；讨论中的首个活跃智能体将成为管理员。',
    'Auto Assemble (Experimental)': '自动组队（实验功能）',
    'Why do you need more agents?': '为什么需要更多智能体？',
    'Maximum agents': '最多智能体数量', 'Allowed adapters': '允许的适配器',
    'Any supported adapter': '任意受支持的适配器', 'Codex only': '仅 Codex',
    'Cursor only': '仅 Cursor', 'Planning UI only in Phase 2A.': '阶段 2A 仅提供规划界面。',
    'Planning Soon': '规划功能即将推出', 'Restart Thread': '重启讨论',
    'Clear workspace contents': '清空工作区内容',
    'Delete everything inside the repo root except': '删除仓库根目录下除以下项目之外的所有内容：',
    '. Disabled by default and blocked for non-git folders or unsafe paths.': '。默认禁用；非 Git 目录和不安全路径不允许执行。',
    'Show Agent Panel': '显示智能体面板', 'Hide Agent Panel': '隐藏智能体面板',
    'Show agent panel': '显示智能体面板', 'Hide agent panel': '隐藏智能体面板',
    'Add agent to this thread': '向当前讨论添加智能体', 'Restart this thread': '重启当前讨论',
    'Export as Markdown': '导出为 Markdown', 'Export thread as Markdown': '将讨论导出为 Markdown',
    'Thread Settings': '讨论设置', 'Thread settings': '讨论设置',
    '⚙️ Thread Settings': '⚙️ 讨论设置',
    'Settings - AgentChatBus': '设置 - AgentChatBus', 'Settings': '设置',
    'Save (Requires Restart)': '保存（需重启服务）', 'Save Settings': '保存设置',
    'Network': '网络', 'Agent Behavior': '智能体行为', 'Agent Lifecycle': '智能体生命周期',
    'Attention': '注意力与交接', 'Attention Mechanisms': '注意力机制',
    'Advanced': '高级', 'Diagnostics': '诊断', 'Runtime Configuration': '运行配置',
    'ACP Agents': 'ACP 智能体', 'UI': '界面', 'Preferences': '界面偏好',
    'Browser User Identity': '浏览器用户身份', 'Browser User': '浏览器用户',
    'Avatar Emoji': '头像表情',
    'A single emoji used as your avatar in message rows, badges, and tooltips. Leave blank for the server default.': '使用一个表情符号作为消息、徽标和提示中的头像。留空时使用服务默认值。',
    'Save Identity': '保存身份',
    'Message minimap (Navigation sidebar)': '消息导航（右侧导航栏）',
    'Enable a scrollable anchor list of messages on the right side of the chat. Helps navigate long conversations using emojis.': '在聊天右侧显示可滚动的消息索引，方便在长对话中通过表情头像定位消息。',
    'Settings cannot be saved from the Diagnostics tab.': '诊断页仅供查看，无法保存设置。',
    'Agent Transport': '智能体连接方式', 'Host': '监听地址', 'Port': '端口',
    'V2: Socket (recommended, no IP config)': 'V2：本地套接字（推荐，无需配置 IP）',
    'V1: HTTP + SSE (legacy)': 'V1：HTTP + SSE（旧版）',
    'Local only (127.0.0.1)': '仅本机（127.0.0.1）',
    'LAN access (0.0.0.0)': '局域网访问（0.0.0.0）',
    'Agent Heartbeat Timeout (seconds)': '智能体心跳超时（秒）',
    'Default msg_wait Timeout (seconds)': '默认 msg_wait 等待超时（秒）',
    'Minimum msg_wait Timeout (ms)': 'msg_wait 最短等待时间（毫秒）',
    'Enforce Minimum msg_wait Timeout': '强制执行 msg_wait 最短等待时间',
    'Reply Token Lease (seconds)': '回复令牌有效期（秒）',
    'Sequence Tolerance': '消息序号容差', 'Seq Mismatch Max Messages': '序号不匹配时最多返回消息数',
    'Rate Limit (messages/minute)': '消息频率限制（条／分钟）',
    'Rate Limiting Enabled': '已启用频率限制',
    'Thread Auto-Close Timeout (minutes)': '讨论自动关闭超时（分钟）',
    'Thread Timeout Sweep Interval (seconds)': '讨论超时检查间隔（秒）',
    'Expose Thread Resources': '提供讨论资源接口', 'Handoff Target Mechanism': '交接目标机制',
    'Stop Reason Mechanism': '停止原因机制', 'Message Priority Mechanism': '消息优先级机制',
    'Use ConPTY for Windows PTY': 'Windows 终端使用 ConPTY',
    'Public Demo Mode': '公开演示模式', 'Admin Token Configured': '已配置管理员令牌',
    'IP Allowlist Enabled': '已启用 IP 白名单', 'Agent Transport Mode': '智能体连接模式',
    'Content Filter Enabled': '已启用内容过滤',
    'Run Diagnostics': '运行诊断', 'Copy Diagnostic Report': '复制诊断报告',
    'Refresh': '刷新', 'Loading...': '加载中…', 'Saving...': '保存中…',
    'Detecting...': '检测中…', 'Detect Models': '检测模型', 'Refresh Models': '刷新模型',
    'Loading models...': '加载模型中…', 'Not supported for ACP agents': 'ACP 智能体不支持此设置',
    'Static fallback': '静态备用列表',
    'Admin Takeover Confirmation Delay (seconds)': '管理员接管确认延迟（秒）',
    'Admin Switch Confirmation Delay (seconds)': '管理员切换确认延迟（秒）',
    'Current Administrator': '当前管理员', 'Unassigned': '尚未分配',
    'The agent responsible for coordination. Admins receive special prompts to guide the conversation flow.': '负责协调的智能体。管理员将收到用于引导对话进程的专用提示。',
    'Wait duration after': '等待时长：在', 'ALL': '所有',
    'participating online agents have entered': '在线参与智能体进入',
    '(indicating an idle conversation) before the system triggers a coordination intervention or requests human assistance. Minimum 30s.': '（对话空闲状态）后，系统等待指定时长，再进行协调干预或请求人工协助。最少 30 秒。',
    'Wait duration before triggering an administrator switch confirmation if the current administrator is offline while other agents are waiting. Minimum 30s.': '当前管理员离线、其他智能体等待时，系统触发管理员切换确认前的等待时长。最少 30 秒。',
    'Click for example': '查看示例',
    'Close': '关闭', 'Cancel': '取消', 'Confirm': '确认', 'Save': '保存',
    'Send': '发送', 'name': '名称',
    "Send a message... Click an agent's row below to mention them!": '输入消息…点击下方智能体可 @ 提及它。',
    '🧵 Copy Thread Name': '🧵 复制讨论名称', '🔀 Compare with current': '🔀 与当前讨论对比',
    '✏️ Rename': '✏️ 重命名', '🏷️ Add tag…': '🏷️ 添加标签…',
    '🔒 Close': '🔒 关闭', '🗄️ Archive': '🗄️ 归档', '📂 Unarchive': '📂 取消归档',
    '📝 Export .md': '📝 导出 .md', '📌 Pin': '📌 置顶', '📍 Unpin': '📍 取消置顶',
    '🗑️ Delete': '🗑️ 删除', 'Pin thread': '置顶讨论', 'Unpin thread': '取消置顶讨论',
    'Agent Quick Prompt': '智能体快捷提示', 'Alias:': '别名：', 'Agent ID:': '智能体 ID：',
    'Model:': '模型：', 'Thread role:': '讨论角色：', 'Copy Agent ID': '复制智能体 ID',
    'Copy Resume Prompt': '复制恢复提示词', 'Thread Instructions (system)': '讨论指令（系统）',
    'This notice is visible only to human participants. Agents cannot read or receive this message.': '此通知仅对人类参与者可见，智能体无法读取或接收。',
    'Visibility: human decision required.': '需要人工决定。',
    'This confirmation card is visible only to human participants.': '此确认卡片仅对人类参与者可见。',
    'Edit message': '编辑消息', 'Copy': '复制', 'Copied!': '已复制！',
    'AgentChatBus lets multiple AI agents chat, debate, and collaborate in shared threads.': 'AgentChatBus 让多个 AI 智能体在共享讨论中交流、辩论和协作。',
    'Supports both local and internet deployment.': '支持本地部署和互联网部署。',
    'AgentChatBus is open source, and these yellow ads are off by default. They are enabled only on this public instance.': 'AgentChatBus 是开源项目，黄色推广信息默认关闭，仅在此公开实例中启用。',
    'AgentChatBus promotion': 'AgentChatBus 项目介绍',
    'Socket Path': '套接字路径', 'Bind Host': '监听地址', 'Engine': '引擎',
    'Runtime': '运行时', 'Version': '版本', 'Transport': '连接协议', 'PTY Mode': '终端模式',
    'Startup Mode': '启动模式', 'Managed by': '管理方', 'Ownership': '管理权',
    'Owner ID': '管理方 ID', 'Modes': '模式', 'msg_wait Min': 'msg_wait 最短等待',
    'msg_wait Policy': 'msg_wait 策略', 'Uptime': '运行时长', 'Started': '启动时间',
    'Schema': '配置结构', 'Messages': '消息', 'Activity': '活动',
    'Agents online': '在线智能体', 'Status': '状态', 'Status Legend:': '状态说明：',
    'Starting:': '启动中：', 'Connecting:': '连接中：', 'Connected:': '已连接：', 'Disconnected:': '已断开：',
    'CLI is launching and bus_connect is not ready yet': 'CLI 正在启动，bus_connect 尚未就绪',
    'CLI is running, but bus_connect has not completed yet': 'CLI 已运行，但 bus_connect 尚未完成',
    'Agent reached the bus and can show tags like msg_wait or Thinking': '智能体已连接，可显示等待或思考等状态',
    'CLI stopped, failed, completed, or the thread is closed': 'CLI 已停止、失败、完成，或讨论已关闭',
    'Administrator': '管理员', 'Participant': '参与者',
    'Idle': '空闲', 'Thinking': '思考中', 'Working': '工作中', 'Offline': '离线',
    'Connection unknown': '连接状态未知', 'Stdio connection': 'Stdio 连接', 'SSE connection': 'SSE 连接',
    'No active agent activity to display.': '暂无智能体活动可显示。',
    'Code Review': '代码审查', 'Security Audit': '安全审计',
    'Architecture': '架构设计', 'Brainstorm': '头脑风暴',
    'Choose Folder': '选择文件夹',
    'Choose a folder for this thread. On Windows, the local service opens a native directory dialog.': '选择此讨论的工作目录。Windows 本地服务将打开文件夹选择窗口。',
    'Legacy Adapters': '旧版适配器', 'Codex (legacy)': 'Codex（旧版）',
    'Cursor (legacy)': 'Cursor（旧版）', 'Copilot (legacy)': 'Copilot（旧版）',
    'Claude (legacy)': 'Claude（旧版）', 'Gemini (legacy)': 'Gemini（旧版）',
    'Not supported for this adapter': '此适配器不支持',
    'Official reasoning level is currently only wired for Codex.': '当前仅为 Codex 接入了官方推理强度设置。',
    'Permission Mode': '权限模式', 'Default': '默认', 'Accept Edits': '允许编辑',
    'Bypass Permissions': '跳过权限确认', "Don't Ask": '不询问',
    'Claude will auto-approve all permission requests without asking.': 'Claude 将自动批准所有权限请求，不再询问。',
    'Direct structured CLI': '直连结构化 CLI',
    'Claude Direct (stream-json)': 'Claude 直连（stream-json）',
    'Instruction Override': '覆盖指令',
    'Timeouts': '超时设置', 'Listening': '监听设置',
    'Requires restart': '需要重启服务',
    'Value source: startup parameter / environment': '配置来源：启动参数／环境变量',
    'Interval used to determine whether an agent is still considered online.': '超过此心跳间隔后，智能体将不再被视为在线。',
    'Default long-poll timeout used when clients do not provide timeout_ms.': '客户端未提供 timeout_ms 时使用的默认长轮询超时。',
    'Controls whether agents can route messages directly to another agent.': '允许智能体将消息直接发送给另一个智能体。',
    'Controls whether agents can annotate messages with a stop reason.': '允许智能体为消息标注停止原因。',
    'Controls whether agents can mark messages as urgent or system priority.': '允许智能体将消息标记为紧急或系统优先级。',
    'V2 (recommended): agents connect via Unix socket / Windows named pipe — no IP or port configuration needed. The HTTP /mcp endpoint remains available, so V1 HTTP + SSE connections are also supported. V1 (legacy): agents connect via HTTP + SSE.': 'V2（推荐）：智能体通过 Unix 套接字或 Windows 命名管道连接，无需配置 IP 和端口。HTTP /mcp 接口仍可用，也支持 V1 HTTP + SSE。V1（旧版）：智能体通过 HTTP + SSE 连接。',
    "The IP address the HTTP/Web UI server binds to. '127.0.0.1' = local-only access; '0.0.0.0' = LAN access (all network interfaces). Only affects the Web UI backend, not agent connections in V2 mode.": 'HTTP／网页服务的监听地址。127.0.0.1 仅允许本机访问；0.0.0.0 允许局域网访问（所有网络接口）。仅影响网页后端，不影响 V2 模式的智能体连接。',
    'The TCP port used by the HTTP and SSE server.': 'HTTP 和 SSE 服务使用的 TCP 端口。',
    'TS-only minimum timeout used to clamp blocking msg_wait polls.': 'TypeScript 后端中阻塞式 msg_wait 轮询的最短超时时间。',
    'Rejects non-quick-return waits shorter than the configured minimum timeout.': '拒绝低于最短超时时间的非快速返回等待请求。',
    'Lifetime of issued reply tokens before they expire.': '已签发回复令牌的有效时长。',
    'Allowed sequence skew before strict sync rejects a request.': '严格同步拒绝请求前允许的消息序号偏差。',
    'Maximum number of messages returned in seq mismatch recovery payloads.': '消息序号不匹配时，恢复响应最多返回的消息数。',
    'Maximum messages an agent can post per minute when rate limiting is enabled.': '启用频率限制后，单个智能体每分钟最多发送的消息数。',
    "Threads in 'discuss' state with no new messages for this many minutes are automatically closed. Default: 10080 (7 days). Set to 0 to disable auto-close. Only affects 'discuss' threads; 'implement', 'review', 'done' etc. are never auto-closed.": '处于讨论中（discuss）状态且持续指定分钟数没有新消息的讨论会自动关闭。默认 10080 分钟（7 天）；设为 0 可禁用。实施、审查、完成等其他状态不会自动关闭。',
    'Polling interval used by the timeout sweeper when thread timeout is enabled.': '启用讨论超时后，后台检查超时的时间间隔。',
    'Allows MCP clients to browse per-thread transcript and state resources.': '允许 MCP 客户端浏览各讨论的对话记录和状态资源。',
    'Windows interactive CLI sessions use ConPTY when enabled. Disable it if Codex/Cursor/Claude/Gemini/Copilot PTY terminals show rendering glitches, freezes, or cursor drift. Restart required.': '启用后，Windows 交互式终端使用 ConPTY。如果终端出现显示异常、卡顿或光标漂移，可关闭此选项。更改需要重启服务。',
    'Readonly view of whether per-agent message rate limiting is active.': '只读：是否启用了单个智能体的消息频率限制。',
    'Readonly view of the secret-pattern content filter guard.': '只读：敏感信息模式内容过滤的启用状态。',
    'Derived from SHOW_AD. When enabled, public-demo security restrictions are active.': '根据 SHOW_AD 确定。启用时，公开演示环境的安全限制生效。',
    'True when AGENTCHATBUS_ADMIN_TOKEN is set.': '已设置 AGENTCHATBUS_ADMIN_TOKEN 时为真。',
    'True when AGENTCHATBUS_ALLOWED_HOSTS contains at least one entry.': 'AGENTCHATBUS_ALLOWED_HOSTS 包含至少一个条目时为真。',
    'Current agent transport protocol: V2 socket or V1 HTTP.': '当前智能体连接协议：V2 套接字或 V1 HTTP。',
    'Run a self-test to verify Database, MCP Tools, and Agent connectivity.': '运行自检，验证数据库、MCP 工具和智能体连接。',
    'Refresh Status': '刷新状态', 'Loading agent statuses...': '正在加载智能体状态…',
    'ACP (Agent Client Protocol) agents are spawned via a standardized JSON-RPC protocol. Enable the agents you want to use in multi-agent meetings. Binary agents must be installed and on your PATH. npx agents are auto-downloaded on first use.': 'ACP 智能体通过标准 JSON-RPC 协议启动。启用要用于多智能体讨论的智能体。本地可执行程序需要已安装并位于 PATH 中；npx 智能体会在首次使用时自动下载。',
    'Message navigation': '消息导航',
    'Client default / manual model ID': '使用客户端默认模型／手动填写模型 ID',
    'Codex discovery unavailable; use client default / manual model ID': 'Codex 模型检测不可用，请使用默认模型或手动填写 ID'
  };
  const foldedZh = new Map(Object.entries(zh).map(([key, value]) => [key.toLowerCase(), value]));

  // These regions contain user/agent data, not interface labels. Preserve their
  // text, including messages that happen to be identical to a dictionary key.
  const protectedContent = [
    '[data-i18n-skip]', '#acb-language-switch', '.msg-bubble', '.bubble-v2', '.msg-author-label',
    '.ti-topic', '.ti-tag', '#thread-title', '#compare-title', '.search-result-item',
    '.msg-native-card__block-content', '.msg-native-card__section-summary',
    '.msg-native-card__block-summary', '.msg-native-card__plan-step',
    '.msg-native-card__item-value', '.msg-native-card__prompt-body',
    '.cli-session-name', '.cli-session-title', '.thread-tag-filter-chip',
    '[contenteditable="true"]', '.xterm', 'pre', 'code'
  ].join(',');
  const ignoredText = 'script,style,svg,textarea,noscript';
  const translatedAttributes = ['title', 'aria-label', 'placeholder', 'data-tooltip', 'data-acb-tooltip'];
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  let language = 'zh-CN';
  try { if (localStorage.getItem(storageKey) === 'en') language = 'en'; } catch (_) { }

  function translate(value) {
    if (language === 'en' || typeof value !== 'string') return value;
    const key = value.trim().replace(/\s+/g, ' ');
    let target = zh[key] || foldedZh.get(key.toLowerCase());
    if (!target) {
      if (/^Connected · /.test(key)) target = key.replace(/^Connected · /, '已连接 · ');
      else if (/^Filter: /.test(key)) {
        const statuses = key.slice(8).replace(/normal \(5\)/g, '常规（5）').replace(/all \(6\)/g, '全部（6）');
        target = '筛选：' + statuses.split(', ').map(s => zh[s] || s).join('、');
      } else if (/^Default from service working directory: /.test(key)) target = key.replace(/^Default from service working directory: /, '默认使用服务工作目录：');
      else if (/^Static fallback · /.test(key)) target = key.replace(/^Static fallback · /, '静态备用列表 · ').replace(/ suggestions? · /, ' 个建议 · ');
      else if (/^[^:]+: Static fallback · \d+ models$/.test(key)) target = key.replace(/: Static fallback · /, '：静态备用列表 · ').replace(/ models$/, ' 个模型');
      else if (/^([🐼🦊].*)?Agent \d+$/.test(key)) target = key.replace(/Agent (\d+)$/, '智能体 $1');
      else if (/^Clear tag filter/.test(key)) target = '清除标签筛选';
      else if (/^\d+ agents? online$/.test(key)) target = key.replace(/ agents? online$/, ' 个智能体在线');
      else if (/^Resolved Launch Prompt · /.test(key)) target = key.replace(/^Resolved Launch Prompt · /, '最终启动提示词 · ').replace(/Administrator$/, '管理员').replace(/Participant$/, '参与者');
    }
    if (!target) return value;
    return value.slice(0, value.length - value.trimStart().length) + target + value.slice(value.trimEnd().length);
  }

  function isProtected(element) {
    return !element || Boolean(element.closest(protectedContent));
  }

  function updateText(node) {
    const parent = node.parentElement;
    if (isProtected(parent) || parent.closest(ignoredText) || !node.nodeValue.trim()) return;
    const previous = textState.get(node);
    const original = previous && node.nodeValue === previous.rendered ? previous.original : node.nodeValue;
    const rendered = translate(original);
    textState.set(node, { original, rendered });
    if (node.nodeValue !== rendered) node.nodeValue = rendered;
  }

  function updateAttributes(element) {
    if (isProtected(element) || element.matches('script,style,svg')) return;
    const previous = attributeState.get(element) || {};
    for (const name of translatedAttributes) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name);
      const old = previous[name];
      const original = old && current === old.rendered ? old.original : current;
      const rendered = translate(original);
      previous[name] = { original, rendered };
      if (current !== rendered) element.setAttribute(name, rendered);
    }
    attributeState.set(element, previous);
  }

  function apply(root) {
    if (root.nodeType === Node.TEXT_NODE) { updateText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || isProtected(root) || root.matches(ignoredText)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && (isProtected(node) || node.matches(ignoredText))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    updateAttributes(root);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) updateText(node);
      else updateAttributes(node);
    }
  }

  function setLanguage(next, persist = true) {
    language = next === 'en' ? 'en' : 'zh-CN';
    if (persist) { try { localStorage.setItem(storageKey, language); } catch (_) { } }
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'AgentChatBus Console' : 'AgentChatBus 控制台';
    const select = document.getElementById('acb-language-switch');
    if (select) select.value = language;
    apply(document.body);
    window.dispatchEvent(new CustomEvent('acb-language-change', { detail: { language } }));
  }

  function init() {
    const topbar = document.getElementById('topbar');
    if (topbar && !document.getElementById('acb-language-switch')) {
      const select = document.createElement('select');
      select.id = 'acb-language-switch';
      select.setAttribute('aria-label', '界面语言 / Language');
      select.title = '界面语言 / Language';
      select.style.cssText = 'flex-shrink:0;max-width:108px;padding:5px 7px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-panel);color:var(--text-1);font:inherit;font-size:12px;cursor:pointer;';
      for (const [value, label] of [['zh-CN', '简体中文'], ['en', 'English']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      select.addEventListener('change', () => setLanguage(select.value));
      topbar.insertBefore(select, document.getElementById('btn-theme-toggle'));
    }
    setLanguage(language, false);
    // Update only changed nodes; native component renders and live status
    // updates keep their English source while the presentation is localized.
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') updateText(record.target);
        else if (record.type === 'attributes') updateAttributes(record.target);
        else record.addedNodes.forEach(apply);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: translatedAttributes });
    window.addEventListener('storage', event => {
      if (event.key === storageKey) setLanguage(event.newValue, false);
    });
  }

  window.AcbI18n = { t: translate, setLanguage, getLanguage: () => language };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
