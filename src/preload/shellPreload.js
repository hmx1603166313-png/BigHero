'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shellApi', {
  getState: () => ipcRenderer.invoke('shell:get-state'),
  addAccount: (payload) => ipcRenderer.invoke('shell:add-account', payload),
  updateAccount: (payload) => ipcRenderer.invoke('shell:update-account', payload),
  deleteAccount: (id) => ipcRenderer.invoke('shell:delete-account', id),
  reorderAccounts: (orderedIds) => ipcRenderer.invoke('shell:reorder-accounts', orderedIds),
  startAccount: (id) => ipcRenderer.invoke('shell:start-account', id),
  startAllAccounts: () => ipcRenderer.invoke('shell:start-all'),
  stopAccount: (id) => ipcRenderer.invoke('shell:stop-account', id),
  reloadAccount: (id) => ipcRenderer.invoke('shell:reload-account', id),
  clearAccountData: (id) => ipcRenderer.invoke('shell:clear-account-data', id),
  selectAccount: (id) => ipcRenderer.invoke('shell:select-account', id),
  setGridMode: (mode) => ipcRenderer.invoke('shell:set-grid-mode', mode),
  toggleGlobalMute: () => ipcRenderer.invoke('shell:toggle-global-mute'),
  toggleAccountMute: (id) => ipcRenderer.invoke('shell:toggle-account-mute', id),
  openDevTools: (id) => ipcRenderer.invoke('shell:open-devtools', id),
  updateSettings: (patch) => ipcRenderer.invoke('shell:update-settings', patch),
  setSidebarWidth: (width) => ipcRenderer.invoke('shell:set-sidebar-width', width),
  setOverlayOpen: (open) => ipcRenderer.invoke('shell:set-overlay-open', open),
  setTheme: (theme) => ipcRenderer.invoke('shell:set-theme', theme),
  hideToTray: () => ipcRenderer.invoke('shell:hide-to-tray'),
  openDataDir: () => ipcRenderer.invoke('shell:open-data-dir'),
  quitApp: () => ipcRenderer.invoke('shell:quit-app'),
  onStateChange: (cb) => {
    const handler = (_ev, state) => cb(state);
    ipcRenderer.on('shell:state', handler);
    return () => ipcRenderer.removeListener('shell:state', handler);
  },
});
