'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell } = require('electron');
const { SessionManager } = require('./sessionManager');

// ---------- 1. 数据目录设置（必须在 app.whenReady 前设置） ----------
// 便携模式或本地开发使用项目/便携目录下 data；安装版统一存入系统 AppData，避免 Program Files 无写入权限
let dataDir;
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  dataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
} else if (!app.isPackaged) {
  dataDir = path.join(path.resolve(__dirname, '../..'), 'data');
} else {
  dataDir = path.join(app.getPath('appData'), 'GameBoxPC');
}
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);

// ---------- 2. Chromium 后台保活启动参数 ----------
if (process.platform === 'linux') {
  // Linux 虚拟桌面/容器环境下禁用硬件加速，避免 GPU 进程初始化失败并刷屏 GL/SharedImage 报错
  app.disableHardwareAcceleration();
}
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 单实例锁：防止重复打开损坏便携数据目录
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let manager = null;
let isQuitting = false;
let currentBossKey = null;

function getIconPath() {
  return path.join(__dirname, '../../build/icon.png');
}

function registerBossKey(shortcut) {
  if (currentBossKey) {
    try { globalShortcut.unregister(currentBossKey); } catch (_) {}
    currentBossKey = null;
  }
  const key = (shortcut || '').trim();
  if (!key) return false;
  try {
    const ok = globalShortcut.register(key, () => toggleBossMode());
    if (ok) currentBossKey = key;
    return ok;
  } catch (_) {
    return false;
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  manager.setBossHidden(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  manager.relayout();
}

function hideToTray(asBoss = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  manager.setBossHidden(asBoss);
  mainWindow.hide();
}

function toggleBossMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    hideToTray(true);
  } else {
    showMainWindow();
  }
}

function updateTray(state) {
  if (!tray) return;
  const online = state ? state.onlineCount : 0;
  const muted = state ? state.settings.globalMuted : false;
  const bossKey = state ? state.settings.bossKey : 'Alt+Q';
  tray.setToolTip(`GameBoxPC · ${online} 个账号在线`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `在线账号：${online} 个`, enabled: false },
    { type: 'separator' },
    { label: `显示 / 隐藏窗口 (${bossKey})`, click: () => toggleBossMode() },
    {
      label: muted ? '取消全局静音' : '全局一键静音',
      click: () => manager.toggleGlobalMute(),
    },
    {
      label: '打开便携数据目录 (data)',
      click: () => shell.openPath(dataDir),
    },
    { type: 'separator' },
    {
      label: '退出并下线全部账号',
      click: () => quitApplication(),
    },
  ]));
}

function quitApplication() {
  isQuitting = true;
  if (manager) manager.destroyAll();
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'GameBoxPC · 多账号网页游戏盒子',
    icon: getIconPath(),
    backgroundColor: '#d3e3fd',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#d3e3fd',
      symbolColor: '#1f1f1f',
      height: 42,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/shellPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  manager.attachWindow(mainWindow);

  mainWindow.on('close', (ev) => {
    if (!isQuitting && manager.settings.closeToTray) {
      ev.preventDefault();
      hideToTray(false);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    // 默认启动第一个账号方便即开即玩
    if (manager.activeId) {
      manager.startAccount(manager.activeId);
    } else {
      manager.emitState();
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(getIconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.focus();
    } else {
      showMainWindow();
    }
  });
  tray.on('double-click', () => showMainWindow());
  updateTray(manager.getState());
}

function registerIpc() {
  ipcMain.handle('shell:get-state', () => manager.getState());
  ipcMain.handle('shell:add-account', (_e, p) => manager.addAccount(p));
  ipcMain.handle('shell:update-account', (_e, p) => manager.updateAccount(p));
  ipcMain.handle('shell:delete-account', (_e, id) => manager.deleteAccount(id));
  ipcMain.handle('shell:reorder-accounts', (_e, ids) => manager.reorderAccounts(ids));
  ipcMain.handle('shell:start-account', (_e, id) => manager.startAccount(id));
  ipcMain.handle('shell:start-all', () => manager.startAllAccounts());
  ipcMain.handle('shell:stop-account', (_e, id) => manager.stopAccount(id));
  ipcMain.handle('shell:reload-account', (_e, id) => manager.reloadAccount(id));
  ipcMain.handle('shell:clear-account-data', (_e, id) => manager.clearAccountData(id));
  ipcMain.handle('shell:select-account', (_e, id) => manager.selectAccount(id));
  ipcMain.handle('shell:set-grid-mode', (_e, mode) => manager.setGridMode(mode));
  ipcMain.handle('shell:toggle-global-mute', () => manager.toggleGlobalMute());
  ipcMain.handle('shell:toggle-account-mute', (_e, id) => manager.toggleAccountMute(id));
  ipcMain.handle('shell:open-devtools', (_e, id) => manager.openDevTools(id));
  ipcMain.handle('shell:update-settings', (_e, patch) => {
    const res = manager.updateSettings(patch);
    if (patch && typeof patch.bossKey === 'string') {
      registerBossKey(patch.bossKey);
    }
    updateTray(manager.getState());
    return res;
  });
  ipcMain.handle('shell:set-sidebar-width', (_e, w) => manager.setSidebarWidth(w));
  ipcMain.handle('shell:set-overlay-open', (_e, open) => manager.setOverlayOpen(open));
  ipcMain.handle('shell:set-theme', (_e, theme) => {
    if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setTitleBarOverlay === 'function') {
      const isDark = theme === 'dark';
      try {
        mainWindow.setTitleBarOverlay({
          color: isDark ? '#202124' : '#d3e3fd',
          symbolColor: isDark ? '#e8eaed' : '#1f1f1f',
          height: 42,
        });
      } catch (_) {}
    }
    return { ok: true };
  });
  ipcMain.handle('shell:hide-to-tray', () => { hideToTray(false); return { ok: true }; });
  ipcMain.handle('shell:open-data-dir', () => shell.openPath(dataDir));
  ipcMain.handle('shell:quit-app', () => { quitApplication(); return { ok: true }; });

  ipcMain.on('gb:view-clicked', (ev) => {
    manager.handleViewClickedByWebContents(ev.sender);
  });
}

app.on('second-instance', () => showMainWindow());

app.whenReady().then(() => {
  manager = new SessionManager(dataDir, (state) => updateTray(state));
  registerIpc();
  createWindow();
  createTray();
  registerBossKey(manager.settings.bossKey);
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});
