/**
 * AgentChatBus - Interactive 3D Rotatable Avatar Studio & Modal (Rework V2)
 *
 * Resolves:
 * P0: Mobile controls moved outside viewport (horizontal, >=44px, no face overlap).
 * P0: True canonical agent avatar binding & full-site application loop.
 * P0: GLTF request generation counter (requestId) & modal close state guards.
 * P1: Deep recursive GPU resource disposal (geometries, materials, textures, controls, renderer).
 * P1: ResizeObserver & document visibility change pause/resume.
 * P1: Collapsed technical audit details by default; honest 2D fallback with 3D recovery.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function disposeHierarchy(node) {
  if (!node) return;
  node.traverse(child => {
    if (child.isMesh) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
          if (!mat) return;
          for (const key of Object.keys(mat)) {
            const val = mat[key];
            if (val && typeof val === 'object' && val.isTexture) {
              val.dispose();
            }
          }
          mat.dispose();
        });
      }
    }
  });
}

class AcbAvatarModal extends HTMLElement {
  constructor() {
    super();
    this.currentKey = 'codex';
    this.targetAgentId = null;
    this.isOpen = false;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.currentModelGroup = null;
    this.animFrameId = null;
    this.loader = new GLTFLoader();
    this.isAutoRotating = false;
    this.webglSupported = true;
    this.loadRequestId = 0;
    this.resizeObserver = null;
    this.boundVisibilityHandler = this.onVisibilityChange.bind(this);
    this.boundKeyDownHandler = this.onKeyDown.bind(this);
  }

  connectedCallback() {
    this.render();
    this.setupListeners();
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    window.addEventListener('keydown', this.boundKeyDownHandler);

    window.AcbAvatarViewer = {
      open: (key, targetAgentId) => this.open(key, targetAgentId),
      close: () => this.close()
    };
  }

  disconnectedCallback() {
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    window.removeEventListener('keydown', this.boundKeyDownHandler);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.disposeThree();
  }

  onKeyDown(e) {
    if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  }

  onVisibilityChange() {
    if (document.hidden) {
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
    } else if (this.isOpen && this.scene && this.camera && this.renderer) {
      if (!this.animFrameId) {
        this.startLoop();
      }
    }
  }

  render() {
    const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    const hintText = isTouch
      ? '👆 单指拖拽 360° 旋转 · 双指捏合缩放'
      : '🖱️ 鼠标拖拽 360° 旋转 · 滚轮缩放 · 右键平移';

    this.innerHTML = `
      <div id="acb-avatar-modal-overlay" class="acb-avatar-overlay" style="display:none;" onclick="if(event.target===this) window.AcbAvatarViewer.close()">
        <div class="acb-avatar-modal-dialog" onclick="event.stopPropagation()">
          
          <!-- Header -->
          <div class="acb-avatar-modal-header">
            <div class="acb-avatar-modal-title">
              <span class="acb-avatar-modal-icon">🎭</span>
              <div>
                <h3>3D 虚拟形象设置</h3>
                <p class="acb-avatar-modal-subtitle">自由旋转预览并绑定智能体头像</p>
              </div>
            </div>
            <button type="button" class="acb-avatar-modal-close" onclick="window.AcbAvatarViewer.close()" aria-label="关闭" title="关闭 (Esc)">✕</button>
          </div>

          <!-- Body -->
          <div class="acb-avatar-modal-body">
            
            <!-- Target Agent Selector -->
            <div class="acb-avatar-target-section">
              <label for="acb-target-agent-select" class="acb-target-label">🎯 绑定目标智能体：</label>
              <select id="acb-target-agent-select" class="acb-target-select">
                <option value="">-- 未选择目标 (仅预览) --</option>
                <option value="abab3492-1635-4ed0-9b56-111367eff554">Codex (abab3492...)</option>
                <option value="dcbc38d2-d526-41c8-8327-c31805a090a2">Antigravity (dcbc38d2...)</option>
                <option value="b2636e9b-6002-436b-9f13-853785924848">OpenCode (b2636e9b...)</option>
                <option value="42f39694-4517-4583-8b6b-96267c907158">Muse · Marley (42f39694...)</option>
              </select>
            </div>

            <!-- Model Selection Tabs (2x2 grid on mobile, row on desktop) -->
            <div class="acb-avatar-tabs" id="avatar-tabs-bar" role="tablist" aria-label="选择 3D 虚拟形象">
              <button type="button" class="acb-avatar-tab-btn active" data-key="codex">Codex Bolt ⚡</button>
              <button type="button" class="acb-avatar-tab-btn" data-key="antigravity">Antigravity 🍩</button>
              <button type="button" class="acb-avatar-tab-btn" data-key="opencode">OpenCode 🍉</button>
              <button type="button" class="acb-avatar-tab-btn" data-key="marley">Muse · Marley 🍍</button>
            </div>

            <!-- 3D Viewport (Clean, NO floating button occlusion) -->
            <div class="acb-avatar-viewport" id="avatar-viewport-container">
              <canvas id="acb-avatar-canvas"></canvas>

              <!-- WebGL Fallback View -->
              <div id="acb-avatar-fallback-view" class="acb-avatar-fallback-container" style="display:none;">
                <div class="acb-avatar-fallback-card" id="fallback-card">
                  <img id="fallback-img" src="" alt="Avatar Preview" />
                  <div class="acb-avatar-fallback-badge">静态 2D 缩略图模式 · WebGL 不可用或模型加载失败</div>
                </div>
              </div>

              <!-- Pure Interaction Hint -->
              <div class="acb-avatar-hint" id="acb-avatar-hint">${hintText}</div>
            </div>

            <!-- Dedicated Controls Strip BELOW Viewport (P0: Horizontal, >=44px, never occludes face) -->
            <div class="acb-avatar-controls-strip">
              <button type="button" class="acb-avatar-ctrl-btn" id="ctrl-reset-btn" title="回正观察视角">↺ 回正视角</button>
              <button type="button" class="acb-avatar-ctrl-btn" id="ctrl-autorotate-btn" title="开关平稳自转">▶ 开启自转</button>
              <button type="button" class="acb-avatar-ctrl-btn" id="ctrl-zoomout-btn" title="拉远视角">🔍 缩小</button>
              <button type="button" class="acb-avatar-ctrl-btn" id="ctrl-zoomin-btn" title="推近视角">🔍 放大</button>
            </div>

            <!-- Model Profile Description -->
            <div class="acb-avatar-meta-desc" id="avatar-desc-text"></div>

            <!-- Collapsible Technical Specifications (Default Closed) -->
            <details class="acb-avatar-tech-details" id="avatar-tech-details">
              <summary class="tech-details-summary">🛠️ 查看模型技术规格与哈希审计</summary>
              <div class="tech-details-content">
                <div class="tech-row">
                  <span class="tech-label">模型格式：</span>
                  <span class="tech-val highlight">glTF 2.0 Binary (GLB)</span>
                </div>
                <div class="tech-row">
                  <span class="tech-label">网格与大小：</span>
                  <span class="tech-val" id="avatar-spec-meshes"></span>
                </div>
                <div class="tech-row">
                  <span class="tech-label">SHA256 校验和：</span>
                  <span class="tech-val mono" id="avatar-sha256-text"></span>
                </div>
                <div class="tech-row">
                  <span class="tech-label">本地托管：</span>
                  <span class="tech-val">100% 离线自托管 (零外部 CDN)</span>
                </div>
              </div>
            </details>

          </div>

          <!-- Footer: 拆为独立提示行、作用域说明行、固定横向按钮行 -->
          <div class="acb-avatar-modal-footer">
            <div class="acb-avatar-modal-feedback-row">
              <div class="acb-avatar-save-status" id="avatar-save-toast"></div>
            </div>
            <div class="acb-avatar-storage-scope-notice">
              <span class="acb-scope-icon">ℹ️</span>
              <span class="acb-scope-text">仅当前浏览器保存，不跨设备同步</span>
            </div>
            <div class="acb-avatar-modal-actions-row">
              <button type="button" class="btn-secondary" onclick="window.AcbAvatarViewer.close()">取消</button>
              <button type="button" class="btn-primary" id="btn-save-avatar" disabled title="请先选择目标智能体以保存绑定">💾 保存形象绑定</button>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  setupListeners() {
    // Model Tabs
    const tabs = this.querySelectorAll('.acb-avatar-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const key = tab.getAttribute('data-key');
        this.selectAvatar(key);
      });
    });

    // Target Agent Selector
    const agentSelect = this.querySelector('#acb-target-agent-select');
    if (agentSelect) {
      agentSelect.addEventListener('change', (e) => {
        this.targetAgentId = e.target.value || null;
        const saveBtn = this.querySelector('#btn-save-avatar');
        if (saveBtn) {
          saveBtn.disabled = !this.targetAgentId;
          saveBtn.title = this.targetAgentId ? '' : '请先选择目标智能体以保存绑定';
        }
        if (this.targetAgentId) {
          this.syncTabsWithTargetAgent();
        }
      });
    }

    // Controls
    ['#ctrl-reset-btn', '#ctrl-autorotate-btn', '#ctrl-zoomout-btn', '#ctrl-zoomin-btn'].forEach(id => {
      const btn = this.querySelector(id);
      if (btn) btn.setAttribute('data-default-title', btn.title);
    });

    const resetBtn = this.querySelector('#ctrl-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => this.resetCamera());

    const autoBtn = this.querySelector('#ctrl-autorotate-btn');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        this.isAutoRotating = !this.isAutoRotating;
        if (this.controls) this.controls.autoRotate = this.isAutoRotating;
        autoBtn.textContent = this.isAutoRotating ? '⏸ 暂停自转' : '▶ 开启自转';
      });
    }

    const zoomInBtn = this.querySelector('#ctrl-zoomin-btn');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        if (!this.camera || !this.controls) return;
        this.camera.position.multiplyScalar(0.85);
        this.controls.update();
      });
    }

    const zoomOutBtn = this.querySelector('#ctrl-zoomout-btn');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        if (!this.camera || !this.controls) return;
        this.camera.position.multiplyScalar(1.15);
        this.controls.update();
      });
    }

    // Save Button
    const saveBtn = this.querySelector('#btn-save-avatar');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (!this.targetAgentId) {
          this.showSaveToast('warning', '⚠️ 请先选择要绑定的目标智能体', 3000);
          return;
        }
        if (!window.AcbAvatarSystem) return;
        const success = window.AcbAvatarSystem.setAgentAvatarBinding(this.targetAgentId, this.currentKey);
        if (success) {
          const model = window.AcbAvatarSystem.getModel(this.currentKey);
          const canonicalList = window.AcbAvatarSystem.getCanonicalAgentsList();
          const targetCfg = canonicalList.find(a => a.id === this.targetAgentId);
          const targetName = targetCfg ? targetCfg.canonicalName : '目标智能体';

          this.showSaveToast('success', `✓ 已绑定【${targetName}】为【${model.name}】（已立即生效）`, 4000);

          // Trigger live UI refresh across chat messages, status column, and 3D arena
          if (window.AcbChat && typeof window.AcbChat.renderMessages === 'function') {
            window.AcbChat.renderMessages();
          }
          if (window.AcbAgentStatus && typeof window.AcbAgentStatus.render === 'function') {
            window.AcbAgentStatus.render();
          }
          if (window.Acb3DArena && typeof window.Acb3DArena.render === 'function') {
            window.Acb3DArena.render();
          }
        } else {
          this.showSaveToast('error', '✕ 保存失败：本地存储写入被拒绝或配额已满', 4000);
        }
      });
    }

    // Interactive 3D tilt for WebP fallback
    const fallbackCard = this.querySelector('#fallback-card');
    if (fallbackCard) {
      fallbackCard.addEventListener('mousemove', (e) => {
        const rect = fallbackCard.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        fallbackCard.style.transform = `perspective(600px) rotateY(${x * 30}deg) rotateX(${-y * 30}deg) scale3d(1.04, 1.04, 1.04)`;
      });
      fallbackCard.addEventListener('mouseleave', () => {
        fallbackCard.style.transform = 'perspective(600px) rotateY(0deg) rotateX(0deg) scale3d(1, 1, 1)';
      });
    }

// Keyboard ESC handled via boundKeyDownHandler with clean lifecycle teardown
  }

  syncTabsWithTargetAgent() {
    if (!window.AcbAvatarSystem) return;
    const bindings = window.AcbAvatarSystem.getBindings();
    const boundKey = bindings[this.targetAgentId];
    if (boundKey && window.AcbAvatarSystem.getModel(boundKey)) {
      this.selectAvatar(boundKey);
    } else {
      const canonical = window.AcbAvatarSystem.canonicalAgents[this.targetAgentId];
      if (canonical && canonical.defaultAvatar) {
        this.selectAvatar(canonical.defaultAvatar);
      }
    }
  }

  showSaveToast(type, message, duration = 4000) {
    const toast = this.querySelector('#avatar-save-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `acb-avatar-save-status is-${type}`;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    if (duration > 0) {
      this._toastTimer = setTimeout(() => {
        if (toast) {
          toast.className = 'acb-avatar-save-status';
          toast.textContent = '';
        }
      }, duration);
    }
  }

  hideSaveToast() {
    const toast = this.querySelector('#avatar-save-toast');
    if (!toast) return;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    toast.className = 'acb-avatar-save-status';
    toast.textContent = '';
  }

  open(initialKey, targetAgentId) {
    this.isOpen = true;
    this.hideSaveToast();
    const overlay = this.querySelector('#acb-avatar-modal-overlay');
    if (overlay) overlay.style.display = 'flex';

    let resolvedTargetId = null;
    if (targetAgentId) {
      if (typeof window !== 'undefined' && window.AcbAvatarSystem && typeof window.AcbAvatarSystem.findCanonicalAgentId === 'function') {
        resolvedTargetId = window.AcbAvatarSystem.findCanonicalAgentId(targetAgentId) || (window.AcbAvatarSystem.canonicalAgents && window.AcbAvatarSystem.canonicalAgents[targetAgentId] ? targetAgentId : null);
      } else {
        resolvedTargetId = targetAgentId;
      }
    }

    this.targetAgentId = resolvedTargetId || null;

    const select = this.querySelector('#acb-target-agent-select');
    if (select) {
      select.value = this.targetAgentId || '';
    }

    const saveBtn = this.querySelector('#btn-save-avatar');
    if (saveBtn) {
      saveBtn.disabled = !this.targetAgentId;
      saveBtn.title = this.targetAgentId ? '' : '请先选择目标智能体以保存绑定';
    }

    // Determine preview avatar model:
    // If initialKey is provided, use it.
    // If initialKey is omitted, but target is selected, read target's current binding to avoid overwriting.
    let targetKey = initialKey;
    if (!targetKey && this.targetAgentId && typeof window !== 'undefined' && window.AcbAvatarSystem) {
      const bindings = window.AcbAvatarSystem.getBindings();
      if (bindings && bindings[this.targetAgentId]) {
        targetKey = bindings[this.targetAgentId];
      } else if (window.AcbAvatarSystem.canonicalAgents && window.AcbAvatarSystem.canonicalAgents[this.targetAgentId]) {
        targetKey = window.AcbAvatarSystem.canonicalAgents[this.targetAgentId].defaultAvatar;
      }
    }

    if (!targetKey) {
      targetKey = 'codex';
    }

    this.initThree();
    this.selectAvatar(targetKey);
  }

  close() {
    this.isOpen = false;
    this.loadRequestId++; // Invalidate any pending in-flight GLTF loads
    const overlay = this.querySelector('#acb-avatar-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    this.disposeThree();
  }

  initThree() {
    const container = this.querySelector('#avatar-viewport-container');
    const canvas = this.querySelector('#acb-avatar-canvas');
    if (!container || !canvas) return;

    if (this.renderer) return;

    const width = container.clientWidth || 480;
    const height = container.clientHeight || 280;

    try {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x131a29);

      this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
      this.camera.position.set(0, 0.45, 6.2);

      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;

      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 2.0;
      this.controls.maxDistance = 9.0;
      this.controls.maxPolarAngle = Math.PI * 0.75;
      this.controls.target.set(0, 0.25, 0);
      this.controls.autoRotate = this.isAutoRotating;
      this.controls.autoRotateSpeed = 1.6;

      // Studio Lighting
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x223344, 1.25);
      this.scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(4, 6, 5);
      keyLight.castShadow = true;
      this.scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x88aaff, 1.2);
      rimLight.position.set(-5, 3, -4);
      this.scene.add(rimLight);

      // Soft ground disc
      const ground = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.55;
      ground.receiveShadow = true;
      this.scene.add(ground);

      const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x1f2b45, roughness: 0.85 }));
      disc.position.y = -1.62;
      disc.receiveShadow = true;
      this.scene.add(disc);

      this.webglSupported = true;
      canvas.style.display = 'block';
      const fallbackView = this.querySelector('#acb-avatar-fallback-view');
      if (fallbackView) fallbackView.style.display = 'none';

      // Setup ResizeObserver on viewport container
      if (window.ResizeObserver && !this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          if (!this.renderer || !this.camera || !container) return;
          const newW = container.clientWidth;
          const newH = container.clientHeight;
          if (newW > 0 && newH > 0) {
            this.camera.aspect = newW / newH;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(newW, newH);
          }
        });
        this.resizeObserver.observe(container);
      }

      this.startLoop();

    } catch (e) {
      console.warn('[AcbAvatarModal] WebGL init failed, switching to 2D fallback mode:', e);
      this.webglSupported = false;
      canvas.style.display = 'none';
      const fallbackView = this.querySelector('#acb-avatar-fallback-view');
      if (fallbackView) fallbackView.style.display = 'flex';
      this.setControlsDisabled(true);
    }
  }

  setControlsDisabled(disabled) {
    const btnIds = ['#ctrl-reset-btn', '#ctrl-autorotate-btn', '#ctrl-zoomout-btn', '#ctrl-zoomin-btn'];
    btnIds.forEach(id => {
      const btn = this.querySelector(id);
      if (btn) {
        btn.disabled = disabled;
        btn.title = disabled
          ? '2D 降级模式下 3D 视角控制不可用'
          : (btn.getAttribute('data-default-title') || btn.title);
        btn.classList.toggle('disabled', disabled);
      }
    });
  }

  startLoop() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      if (this.controls) this.controls.update();
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();
  }

  resetCamera() {
    if (!this.camera || !this.controls) return;
    const model = window.AcbAvatarSystem ? window.AcbAvatarSystem.getModel(this.currentKey) : null;
    const camCfg = model?.camera || { position: [0, 0.45, 6.2], target: [0, 0.25, 0] };
    this.camera.position.set(...camCfg.position);
    this.controls.target.set(...camCfg.target);
    this.controls.update();
  }

  selectAvatar(key) {
    this.currentKey = key;
    const model = window.AcbAvatarSystem ? window.AcbAvatarSystem.getModel(key) : null;
    if (!model) return;

    // Update active tab styling
    const tabs = this.querySelectorAll('.acb-avatar-tab-btn');
    tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-key') === key));

    // Update description text
    const descEl = this.querySelector('#avatar-desc-text');
    if (descEl) descEl.textContent = `${model.name} · ${model.desc}`;

    // Update collapsed technical details
    const meshesEl = this.querySelector('#avatar-spec-meshes');
    if (meshesEl) meshesEl.textContent = `${model.glbMeshes} 个独立网格 (${(model.glbSize / 1024).toFixed(1)} KB)`;

    const shaEl = this.querySelector('#avatar-sha256-text');
    if (shaEl) shaEl.textContent = model.glbSha256;

    // Update fallback image preview
    const fallbackImg = this.querySelector('#fallback-img');
    if (fallbackImg && model.webp) {
      fallbackImg.src = model.webp;
    }

    if (!this.webglSupported || !this.scene) return;

    // Background color tune
    const bgColor = new THREE.Color(model.bgColor).multiplyScalar(0.35);
    this.scene.background = bgColor;

    // Dispose old model cleanly
    if (this.currentModelGroup) {
      this.scene.remove(this.currentModelGroup);
      disposeHierarchy(this.currentModelGroup);
      this.currentModelGroup = null;
    }

    // P0: Generation request counter to prevent out-of-order race conditions
    const reqId = ++this.loadRequestId;

    this.loader.load(
      model.glb,
      (gltf) => {
        // Guard 1: Stale request check (user switched tab while loading)
        if (reqId !== this.loadRequestId) {
          disposeHierarchy(gltf.scene);
          return;
        }
        // Guard 2: Modal closed check
        if (!this.isOpen || !this.scene) {
          disposeHierarchy(gltf.scene);
          return;
        }

        this.currentModelGroup = gltf.scene;
        this.currentModelGroup.position.set(0, 0, 0);
        this.currentModelGroup.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(this.currentModelGroup);
        this.resetCamera();

        // Ensure canvas is visible and fallback is hidden on success
        const canvas = this.querySelector('#acb-avatar-canvas');
        if (canvas) canvas.style.display = 'block';
        const fallbackView = this.querySelector('#acb-avatar-fallback-view');
        if (fallbackView) fallbackView.style.display = 'none';
        this.setControlsDisabled(false);
      },
      undefined,
      (err) => {
        // Stale or closed check
        if (reqId !== this.loadRequestId || !this.isOpen) return;

        console.warn(`[AcbAvatarModal] Failed to load GLB for ${key}, falling back to 2D:`, err);
        const canvas = this.querySelector('#acb-avatar-canvas');
        if (canvas) canvas.style.display = 'none';
        const fallbackView = this.querySelector('#acb-avatar-fallback-view');
        if (fallbackView) fallbackView.style.display = 'flex';
        this.setControlsDisabled(true);
      }
    );
  }

  disposeThree() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.currentModelGroup && this.scene) {
      this.scene.remove(this.currentModelGroup);
      disposeHierarchy(this.currentModelGroup);
      this.currentModelGroup = null;
    }

    if (this.scene) {
      disposeHierarchy(this.scene);
      this.scene = null;
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.camera = null;
  }
}

if (!customElements.get('acb-avatar-modal')) {
  customElements.define('acb-avatar-modal', AcbAvatarModal);
}

window.AcbAvatarViewer = {
  open(avatarKey, targetAgentId) {
    const el = document.querySelector('acb-avatar-modal');
    if (el) el.open(avatarKey, targetAgentId);
  },
  close() {
    const el = document.querySelector('acb-avatar-modal');
    if (el) el.close();
  },
  showSaveToast(type, message, duration) {
    const el = document.querySelector('acb-avatar-modal');
    if (el && typeof el.showSaveToast === 'function') {
      el.showSaveToast(type, message, duration);
    }
  },
  hideSaveToast() {
    const el = document.querySelector('acb-avatar-modal');
    if (el && typeof el.hideSaveToast === 'function') {
      el.hideSaveToast();
    }
  }
};
