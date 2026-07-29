const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Minecraft ──────────────────────────────────────────────
  launchMinecraft: (settings) => ipcRenderer.invoke('minecraft:launch', settings),
  isMinecraftRunning: () => ipcRenderer.invoke('minecraft:isRunning'),
  killMinecraft: () => ipcRenderer.invoke('minecraft:kill'),

  // ─── Progression ───────────────────────────────────────────
  onDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
  onGameExited: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('game-exited', handler);
    return () => ipcRenderer.removeListener('game-exited', handler);
  },

  // ─── Configuration ─────────────────────────────────────────
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (settings) => ipcRenderer.invoke('config:save', settings),

  // ─── Dialogues ─────────────────────────────────────────────
  selectJava: () => ipcRenderer.invoke('dialog:selectJava'),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // ─── Shell ─────────────────────────────────────────────────
  openPath: (dirPath) => ipcRenderer.invoke('shell:openPath', dirPath),

  // ─── Chemins ───────────────────────────────────────────────
  getPaths: () => ipcRenderer.invoke('app:getPaths'),
  getJavaPath: () => ipcRenderer.invoke('app:getJavaPath'),

  // ─── Fenêtre ───────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  titlebarContextMenu: () => ipcRenderer.send('window:titlebarContextMenu'),
  setWindowMovable: (movable) => ipcRenderer.invoke('window:setMovable', movable),

  // ─── Auto-update ───────────────────────────────────────────
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateChecking: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('update:checking', handler);
    return () => ipcRenderer.removeListener('update:checking', handler);
  },
  onUpdateAvailable: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateNotAvailable: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('update:not-available', handler);
    return () => ipcRenderer.removeListener('update:not-available', handler);
  },
  onUpdateDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update:download-progress', handler);
    return () => ipcRenderer.removeListener('update:download-progress', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateError: (callback) => {
    const handler = (event, msg) => callback(msg);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },

  // ─── Versions ─────────────────────────────────────────────
  getVersions: () => ipcRenderer.invoke('app:getVersions'),

  // ─── URL du serveur de mods ──────────────────────────────
  getServerUrl: () => ipcRenderer.invoke('app:getServerUrl'),

  // ═══════════════════════════════════════════════════════════════
  //  AUTH
  // ═══════════════════════════════════════════════════════════════

  // ─── Microsoft login (popup intégrée) ─────────────────────
  authMicrosoftLogin: () => ipcRenderer.invoke('auth:microsoft:login'),

  // ─── Session ───────────────────────────────────────────────
  authGetSession: () => ipcRenderer.invoke('auth:getSession'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),

  // ─── Crack (offline) ───────────────────────────────────────
  authCrack: (username) => ipcRenderer.invoke('auth:crack', username),

  // ─── Refresh Microsoft token ───────────────────────────────
  authRefresh: () => ipcRenderer.invoke('auth:refresh'),
});
