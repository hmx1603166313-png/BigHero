'use strict';

const fs = require('fs');
const path = require('path');
const { WebContentsView, session, shell, app } = require('electron');

const DEFAULT_GAME_URL = 'https://www.wanyiwan.top/game/xxyx2060170000354938';
const TOPBAR_HEIGHT = 88; // 42px Chrome 标签栏 + 46px 地址工具栏
const GRID_GAP = 3;

const GAME_SCROLLBAR_CSS = `
  ::-webkit-scrollbar {
    width: 8px !important;
    height: 8px !important;
    background: transparent !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
  ::-webkit-scrollbar-corner {
    background: transparent !important;
  }
  ::-webkit-scrollbar-button {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  ::-webkit-scrollbar-thumb {
    background-color: rgba(154, 160, 166, 0.35) !important;
    border-radius: 999px !important;
    border: 2px solid transparent !important;
    background-clip: content-box !important;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(154, 160, 166, 0.62) !important;
  }
  ::-webkit-scrollbar-thumb:active {
    background-color: rgba(154, 160, 166, 0.8) !important;
  }
`;

const DEFAULT_SETTINGS = {
  defaultUrl: DEFAULT_GAME_URL,
  gridMode: 1, // 1 | 2 | 4 | 6 | 9
  bgFps: 10, // 0 = 不限帧, 15 / 10 / 5
  focusAudioOnly: true,
  globalMuted: false,
  closeToTray: true,
  bossKey: 'Alt+Q',
  maxConcurrent: 10,
  sidebarWidth: 210,
};

function gridDimensions(mode) {
  switch (Number(mode)) {
    case 2: return { cols: 2, rows: 1, cap: 2 };
    default: return { cols: 1, rows: 1, cap: 1 };
  }
}

class SessionManager {
  constructor(dataDir, onStateChanged) {
    this.dataDir = dataDir;
    this.onStateChanged = onStateChanged;
    this.accountsFile = path.join(dataDir, 'accounts.json');
    this.settingsFile = path.join(dataDir, 'settings.json');

    this.accounts = this._loadJson(this.accountsFile, []);
    this.settings = { ...DEFAULT_SETTINGS, ...this._loadJson(this.settingsFile, {}) };
    if (![1, 2].includes(Number(this.settings.gridMode))) {
      this.settings.gridMode = 1;
    }

    /** @type {Map<string, { view: WebContentsView, accountId: string, crashed: boolean, bgFps: number }>} */
    this.sessions = new Map();
    this.activeId = this.accounts[0]?.id || null;
    this.mainWindow = null;
    this.overlayOpen = false;
    this.windowHidden = false;
    this.bossHidden = false;
    this.visibleSlots = []; // [{ accountId, x, y, width, height, active }]

    // 清理 Electron 标识，生成标准 Windows Chrome UA
    const chromeMatch = (app.userAgentFallback || '').match(/Chrome\/(\d+)/);
    const chromeMajor = chromeMatch ? chromeMatch[1] : '130';
    this.chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

    // 首次启动自动预置 1 个默认账号，方便开箱即用
    if (this.accounts.length === 0) {
      const first = {
        id: this._newId(),
        name: '账号 1',
        note: '大号',
        url: this.settings.defaultUrl,
        muted: false,
      };
      this.accounts.push(first);
      this.activeId = first.id;
      this._saveAccounts();
    }
  }

  attachWindow(win) {
    this.mainWindow = win;
    win.on('resize', () => this.relayout());
    win.on('maximize', () => setTimeout(() => this.relayout(), 50));
    win.on('unmaximize', () => setTimeout(() => this.relayout(), 50));
    win.on('minimize', () => {
      this.windowHidden = true;
      this.syncRuntimeStates();
    });
    win.on('restore', () => {
      this.windowHidden = false;
      this.relayout();
    });
    win.on('hide', () => {
      this.windowHidden = true;
      this.syncRuntimeStates();
    });
    win.on('show', () => {
      this.windowHidden = false;
      this.relayout();
    });
  }

  _newId() {
    return Date.now().toString(36) + Math.floor(100 + Math.random() * 900).toString(36);
  }

  _loadJson(file, fallback) {
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (_) {}
    return fallback;
  }

  _saveJson(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  _saveAccounts() {
    this._saveJson(this.accountsFile, this.accounts);
  }

  _saveSettings() {
    this._saveJson(this.settingsFile, this.settings);
  }

  getState() {
    return {
      accounts: this.accounts.map((a) => {
        const s = this.sessions.get(a.id);
        return {
          ...a,
          running: !!s,
          crashed: !!(s && s.crashed),
          bgFps: s ? s.bgFps : null,
        };
      }),
      activeId: this.activeId,
      settings: { ...this.settings },
      onlineCount: this.sessions.size,
      visibleSlots: this.visibleSlots,
      dataDir: this.dataDir,
    };
  }

  emitState() {
    const state = this.getState();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('shell:state', state);
    }
    if (this.onStateChanged) this.onStateChanged(state);
  }

  addAccount({ name, note, url, autoStart = true }) {
    const finalUrl = (url || '').trim() || this.settings.defaultUrl || DEFAULT_GAME_URL;
    const acc = {
      id: this._newId(),
      name: (name || '').trim() || `账号 ${this.accounts.length + 1}`,
      note: (note || '').trim(),
      url: finalUrl,
      muted: false,
    };
    this.accounts.push(acc);
    this.settings.defaultUrl = finalUrl;
    this._saveAccounts();
    this._saveSettings();
    if (autoStart) {
      this.selectAccount(acc.id);
    } else {
      this.emitState();
    }
    return { ok: true, account: acc };
  }

  updateAccount({ id, name, note, url }) {
    const acc = this.accounts.find((a) => a.id === id);
    if (!acc) return { ok: false, error: '账号不存在' };
    const oldUrl = acc.url;
    if (typeof name === 'string' && name.trim()) acc.name = name.trim();
    if (typeof note === 'string') acc.note = note.trim();
    if (typeof url === 'string' && url.trim()) acc.url = url.trim();
    this._saveAccounts();
    const s = this.sessions.get(id);
    if (s && acc.url !== oldUrl) {
      s.view.webContents.loadURL(acc.url);
    }
    this.emitState();
    return { ok: true };
  }

  reorderAccounts(orderedIds) {
    if (!Array.isArray(orderedIds)) return { ok: false };
    const map = new Map(this.accounts.map((a) => [a.id, a]));
    const next = [];
    for (const id of orderedIds) {
      if (map.has(id)) {
        next.push(map.get(id));
        map.delete(id);
      }
    }
    for (const rest of map.values()) next.push(rest);
    this.accounts = next;
    this._saveAccounts();
    this.relayout();
    return { ok: true };
  }

  async deleteAccount(id) {
    const idx = this.accounts.findIndex((a) => a.id === id);
    if (idx === -1) return { ok: false };
    await this.clearAccountData(id, false);
    this.accounts.splice(idx, 1);
    this._saveAccounts();
    if (this.activeId === id) {
      this.activeId = this.accounts[0]?.id || null;
    }
    this.relayout();
    return { ok: true };
  }

  startAccount(id) {
    const acc = this.accounts.find((a) => a.id === id);
    if (!acc) return { ok: false, error: '账号不存在' };
    if (this.sessions.has(id)) {
      this.relayout();
      return { ok: true };
    }
    if (this.sessions.size >= this.settings.maxConcurrent) {
      return {
        ok: false,
        error: `已达到同时在线上限（${this.settings.maxConcurrent} 个），请先停止不用的账号或在设置中调高上限`,
      };
    }

    const partition = `persist:acc_${acc.id}`;
    const ses = session.fromPartition(partition);
    ses.setUserAgent(this.chromeUA);

    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: path.join(__dirname, '../preload/gamePreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        nodeIntegrationInSubFrames: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });

    view.setBackgroundColor('#202124');
    const wc = view.webContents;
    wc.setUserAgent(this.chromeUA);

    // 防止新窗口跳出破坏多开，同域走弹出小窗，外部协议交给系统
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 900,
            height: 680,
            autoHideMenuBar: true,
            webPreferences: {
              partition,
              contextIsolation: true,
              nodeIntegration: false,
              backgroundThrottling: false,
            },
          },
        };
      }
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });

    const entry = { view, accountId: acc.id, crashed: false, bgFps: 0 };
    this.sessions.set(acc.id, entry);

    wc.on('render-process-gone', (_ev, details) => {
      entry.crashed = true;
      console.warn(`[Session ${acc.name}] renderer gone:`, details.reason);
      this.emitState();
    });

    wc.on('did-finish-load', () => {
      entry.crashed = false;
      wc.insertCSS(GAME_SCROLLBAR_CSS).catch(() => {});
      this.syncRuntimeStates();
    });

    wc.on('did-frame-finish-load', () => {
      this.syncRuntimeStates();
    });

    wc.on('focus', () => {
      if (this.activeId !== acc.id) {
        this.activeId = acc.id;
        this.relayout();
      }
    });

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.contentView.addChildView(view);
    }

    wc.loadURL(acc.url);
    if (!this.activeId) this.activeId = acc.id;
    this.relayout();
    return { ok: true };
  }

  startAllAccounts() {
    const errors = [];
    for (const acc of this.accounts) {
      if (this.sessions.size >= this.settings.maxConcurrent) break;
      if (!this.sessions.has(acc.id)) {
        const res = this.startAccount(acc.id);
        if (!res.ok && res.error) errors.push(res.error);
      }
    }
    this.relayout();
    return { ok: errors.length === 0, error: errors[0] };
  }

  stopAccount(id) {
    const entry = this.sessions.get(id);
    if (!entry) return { ok: true };
    this.sessions.delete(id);
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.contentView.removeChildView(entry.view);
      }
      entry.view.webContents.close({ waitForBeforeUnload: false });
    } catch (_) {}
    this.relayout();
    return { ok: true };
  }

  reloadAccount(id) {
    const targetId = id || this.activeId;
    if (!targetId) return { ok: false };
    const entry = this.sessions.get(targetId);
    if (!entry) return this.startAccount(targetId);
    if (entry.crashed) {
      this.stopAccount(targetId);
      return this.startAccount(targetId);
    }
    entry.view.webContents.reload();
    return { ok: true };
  }

  async clearAccountData(id, restartIfWasRunning = true) {
    const wasRunning = this.sessions.has(id);
    this.stopAccount(id);
    const ses = session.fromPartition(`persist:acc_${id}`);
    try {
      await ses.clearStorageData();
      await ses.clearCache();
    } catch (_) {}
    if (restartIfWasRunning && wasRunning) {
      this.startAccount(id);
    } else {
      this.emitState();
    }
    return { ok: true };
  }

  selectAccount(id) {
    const acc = this.accounts.find((a) => a.id === id);
    if (!acc) return { ok: false };
    this.activeId = id;
    if (!this.sessions.has(id)) {
      const res = this.startAccount(id);
      if (!res.ok) {
        this.emitState();
        return res;
      }
    } else {
      this.relayout();
    }
    return { ok: true };
  }

  handleViewClickedByWebContents(wc) {
    for (const [id, entry] of this.sessions.entries()) {
      if (entry.view.webContents === wc) {
        if (this.activeId !== id) {
          this.activeId = id;
          this.relayout();
        }
        break;
      }
    }
  }

  setGridMode(mode) {
    const valid = [1, 2];
    this.settings.gridMode = valid.includes(Number(mode)) ? Number(mode) : 1;
    this._saveSettings();
    this.relayout();
    return { ok: true };
  }

  toggleGlobalMute() {
    this.settings.globalMuted = !this.settings.globalMuted;
    this._saveSettings();
    this.syncRuntimeStates();
    this.emitState();
    return { ok: true, globalMuted: this.settings.globalMuted };
  }

  toggleAccountMute(id) {
    const acc = this.accounts.find((a) => a.id === id);
    if (!acc) return { ok: false };
    acc.muted = !acc.muted;
    this._saveAccounts();
    this.syncRuntimeStates();
    this.emitState();
    return { ok: true };
  }

  openDevTools(id) {
    const targetId = id || this.activeId;
    const entry = targetId ? this.sessions.get(targetId) : null;
    if (!entry) return { ok: false };
    entry.view.webContents.openDevTools({ mode: 'detach' });
    return { ok: true };
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this._saveSettings();
    this.relayout();
    return { ok: true, settings: { ...this.settings } };
  }

  setSidebarWidth(width) {
    const w = Math.max(0, Math.min(360, Number(width) || 0));
    this.settings.sidebarWidth = w;
    this._saveSettings();
    this.relayout();
    return { ok: true };
  }

  setOverlayOpen(open) {
    this.overlayOpen = !!open;
    this.relayout();
    return { ok: true };
  }

  setBossHidden(hidden) {
    this.bossHidden = !!hidden;
    this.windowHidden = !!hidden;
    this.syncRuntimeStates();
  }

  /** 计算可见宫格账号列表并更新每个 WebContentsView 的 bounds */
  relayout() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const [winW, winH] = this.mainWindow.getContentSize();
    const sidebarW = this.settings.sidebarWidth;
    const areaX = sidebarW;
    const areaY = TOPBAR_HEIGHT;
    const areaW = Math.max(100, winW - sidebarW);
    const areaH = Math.max(100, winH - TOPBAR_HEIGHT);

    const { cols, rows, cap } = gridDimensions(this.settings.gridMode);
    const visibleIds = [];

    // 1. 当前激活账号优先放进可见格
    if (this.activeId && this.sessions.has(this.activeId)) {
      visibleIds.push(this.activeId);
    }
    // 2. 多宫格时按侧边栏顺序补齐其他在线账号
    for (const acc of this.accounts) {
      if (visibleIds.length >= cap) break;
      if (this.sessions.has(acc.id) && !visibleIds.includes(acc.id)) {
        visibleIds.push(acc.id);
      }
    }

    const visibleSet = new Set(visibleIds);
    const slots = [];
    const cellW = Math.floor((areaW - GRID_GAP * (cols + 1)) / cols);
    const cellH = Math.floor((areaH - GRID_GAP * (rows + 1)) / rows);

    visibleIds.forEach((id, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = areaX + GRID_GAP + col * (cellW + GRID_GAP);
      const y = areaY + GRID_GAP + row * (cellH + GRID_GAP);
      slots.push({
        accountId: id,
        x,
        y,
        width: Math.max(120, cellW),
        height: Math.max(120, cellH),
        active: id === this.activeId,
      });
    });

    this.visibleSlots = slots;

    const slotById = new Map(slots.map((s) => [s.accountId, s]));
    for (const [id, entry] of this.sessions.entries()) {
      const slot = !this.overlayOpen ? slotById.get(id) : null;
      if (slot) {
        entry.view.setBounds({
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
        });
      } else {
        // 保持非零宽高移出可视区，避免 WebGL 上下文因 0x0 丢失或触发冻结
        entry.view.setBounds({ x: -10000, y: -10000, width: 960, height: 600 });
      }
    }

    this.syncRuntimeStates(visibleSet);
    this.emitState();
  }

  /** 同步每个在线账号的静音状态与后台降帧状态（含主页面与 #game-iframe） */
  syncRuntimeStates(visibleSetOverride) {
    const visibleSet = visibleSetOverride || new Set(this.visibleSlots.map((s) => s.accountId));
    const appVisible = !this.windowHidden && !this.bossHidden && !this.overlayOpen;

    for (const [id, entry] of this.sessions.entries()) {
      const acc = this.accounts.find((a) => a.id === id);
      const isVisible = appVisible && visibleSet.has(id);
      const wc = entry.view.webContents;
      if (wc.isDestroyed()) continue;

      // 1. 音频控制
      let muted = false;
      if (this.bossHidden || this.settings.globalMuted) {
        muted = true;
      } else if (acc && acc.muted) {
        muted = true;
      } else if (this.settings.focusAudioOnly && id !== this.activeId) {
        muted = true;
      }
      wc.setAudioMuted(muted);

      // 2. 后台智能降帧：前台/宫格可见 = 0 (60fps)，后台或最小化到托盘 = settings.bgFps (如 10fps)
      const targetFps = isVisible ? 0 : (Number(this.settings.bgFps) || 0);
      entry.bgFps = targetFps;
      try {
        const frames = wc.mainFrame?.framesInSubtree || [];
        for (const frame of frames) {
          try {
            frame.send('gb:bg-fps', targetFps);
          } catch (_) {}
        }
      } catch (_) {}
    }
  }

  destroyAll() {
    for (const id of Array.from(this.sessions.keys())) {
      this.stopAccount(id);
    }
  }
}

module.exports = { SessionManager, DEFAULT_GAME_URL };
