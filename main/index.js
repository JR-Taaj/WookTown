const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const Config = require('./config');
const MinecraftLauncher = require('./minecraft');
const MinecraftAuth = require('./auth');

let mainWindow = null;
let launcher = null;
let auth = null;

// ─── Auto-updater config ──────────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// ═══════════════════════════════════════════════════════════════
//  Auto-updater events — forward to renderer
// ═══════════════════════════════════════════════════════════════

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdate] Vérification des mises à jour...');
    mainWindow?.webContents.send('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdate] Nouvelle version disponible : ${info.version}`);
    mainWindow?.webContents.send('update:available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdate] Aucune mise à jour disponible');
    mainWindow?.webContents.send('update:not-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    console.log(`[AutoUpdate] Téléchargement : ${pct}%`);
    mainWindow?.webContents.send('update:download-progress', { percent: pct, bytesPerSecond: progress.bytesPerSecond, total: progress.total, transferred: progress.transferred });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[AutoUpdate] Mise à jour ${info.version} téléchargée`);
    mainWindow?.webContents.send('update:downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    console.error(`[AutoUpdate] Erreur : ${err.message}`);
    mainWindow?.webContents.send('update:error', err.message);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 960,
    minHeight: 600,
    title: 'WookTown Launcher',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    frame: false,
    transparent: false,
    backgroundColor: '#0a0b0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Charger le build s'il existe, sinon React dev server
  const buildIndex = path.join(__dirname, '..', 'build', 'index.html');
  const isDev = !app.isPackaged;

  if (isDev && fs.existsSync(buildIndex)) {
    mainWindow.loadFile(buildIndex);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(buildIndex);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ═══════════════════════════════════════════════════════════════
//  IPC Handlers
// ═══════════════════════════════════════════════════════════════

function setupIPC() {
  // ─── Minecraft ─────────────────────────────────────────────
  ipcMain.handle('minecraft:launch', async (event, settings) => {
    try {
      if (!mainWindow) throw new Error('Fenêtre non initialisée');
      launcher = new MinecraftLauncher(mainWindow);
      await launcher.launch(settings);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('minecraft:isRunning', () => {
    return launcher ? launcher.isRunning() : false;
  });

  ipcMain.handle('minecraft:kill', () => {
    if (launcher) launcher.kill();
    return { success: true };
  });

  // ─── Config ────────────────────────────────────────────────
  ipcMain.handle('config:load', () => {
    const configPath = path.join(Config.LAUNCHER_DIR, 'settings.json');
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch { return {}; }
    }
    return {};
  });

  ipcMain.handle('config:save', (event, settings) => {
    const configPath = path.join(Config.LAUNCHER_DIR, 'settings.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
    return { success: true };
  });

  // ─── Dialogues ──────────────────────────────────────────────
  ipcMain.handle('dialog:selectJava', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner javaw.exe ou java.exe',
      filters: [{ name: 'Java', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
  });

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner le dossier de jeu',
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
  });

  // ─── Shell ──────────────────────────────────────────────────
  ipcMain.handle('shell:openPath', (event, dirPath) => {
    shell.openPath(dirPath);
    return { success: true };
  });

  // ─── Chemins ────────────────────────────────────────────────
  ipcMain.handle('app:getPaths', () => {
    return {
      minecraftDir: Config.MINECRAFT_DIR,
      modsDir: Config.MODS_DIR,
      logsDir: Config.LOGS_DIR,
      launcherDir: Config.LAUNCHER_DIR,
      versionsDir: Config.VERSIONS_DIR,
    };
  });

  ipcMain.handle('app:getJavaPath', () => {
    const configPath = path.join(Config.LAUNCHER_DIR, 'settings.json');
    if (fs.existsSync(configPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return settings.javaPath || '';
      } catch {}
    }
    return '';
  });

  // ─── Fenêtre ────────────────────────────────────────────────
  ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window:close', () => { if (mainWindow) mainWindow.close(); });
  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });
  ipcMain.handle('window:isMaximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });
  ipcMain.on('window:titlebarContextMenu', () => {
    if (mainWindow) {
      const { Menu } = require('electron');
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Restaurer', click: () => mainWindow.unmaximize(), enabled: mainWindow.isMaximized() },
        { label: 'Déplacer', click: () => mainWindow.setMovable(true) },
        { label: 'Taille', click: () => mainWindow.setResizable(true), enabled: !mainWindow.isMaximized() },
        { label: 'Réduire', click: () => mainWindow.minimize() },
        { label: 'Agrandir', click: () => mainWindow.maximize(), enabled: !mainWindow.isMaximized() },
        { type: 'separator' },
        { label: 'Fermer', click: () => mainWindow.close() },
      ]);
      contextMenu.popup({ window: mainWindow });
    }
  });
  ipcMain.handle('window:setMovable', (event, movable) => {
    if (mainWindow) mainWindow.setMovable(movable);
  });

  // ─── Versions ────────────────────────────────────────────────
  ipcMain.handle('app:getVersions', () => {
    return {
      fabricLoader: Config.FABRIC_LOADER_VERSION,
      minecraft: Config.MINECRAFT_VERSION,
      launcher: app.getVersion(),
    };
  });

  // ─── URL du serveur de mods ─────────────────────────────────
  ipcMain.handle('app:getServerUrl', () => {
    return Config.SERVER_URL;
  });

  // ─── Mise à jour ────────────────────────────────────────────
  ipcMain.handle('update:check', async () => {
    try {
      if (app.isPackaged) {
        autoUpdater.checkForUpdates();
        return { success: true };
      }
      return { success: false, error: 'Mode développement - pas de mise à jour' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('update:install', async () => {
    try {
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  AUTH IPC
  // ═══════════════════════════════════════════════════════════════

  ipcMain.handle('auth:microsoft:login', async () => {
    try {
      if (!auth) auth = new MinecraftAuth();
      const session = await auth.microsoftLoginPopup();
      saveAuthSession(session);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:getSession', () => {
    const session = loadAuthSession();
    if (session) return { success: true, session };
    return { success: false };
  });

  ipcMain.handle('auth:logout', () => {
    const sessionPath = path.join(Config.LAUNCHER_DIR, 'auth-session.json');
    try { if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath); } catch {}
    delete global._authState;
    return { success: true };
  });

  ipcMain.handle('auth:crack', async (event, username) => {
    try {
      if (!auth) auth = new MinecraftAuth();
      const session = auth.createOfflineSession(username);
      saveAuthSession(session);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:refresh', async () => {
    try {
      if (!auth) auth = new MinecraftAuth();
      const session = loadAuthSession();
      if (!session || session.type !== 'microsoft' || !session.refreshToken) {
        throw new Error('Aucune session Microsoft à rafraîchir');
      }
      const newSession = await auth.refreshMicrosoftToken(session.refreshToken);
      saveAuthSession(newSession);
      return { success: true, session: newSession };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  Auth Session persistence
// ═══════════════════════════════════════════════════════════════

function saveAuthSession(session) {
  const sessionPath = path.join(Config.LAUNCHER_DIR, 'auth-session.json');
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  const toSave = {
    type: session.type,
    username: session.username,
    uuid: session.uuid,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || null,
  };
  fs.writeFileSync(sessionPath, JSON.stringify(toSave, null, 2));
}

function loadAuthSession() {
  const sessionPath = path.join(Config.LAUNCHER_DIR, 'auth-session.json');
  if (fs.existsSync(sessionPath)) {
    try {
      return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    } catch {}
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  App lifecycle
// ═══════════════════════════════════════════════════════════════

function setupLauncher() {
  if (mainWindow) {
    launcher = new MinecraftLauncher(mainWindow);
  }
}

function startModsServer() {
  const isRemote = Config.SERVER_HOST !== '127.0.0.1' && Config.SERVER_HOST !== 'localhost';
  if (isRemote) {
    console.log(`[ModsServer] Serveur distant configuré : ${Config.SERVER_URL}`);
    console.log('[ModsServer] Aucun serveur local démarré.');
    return;
  }

  const serverPath = path.join(__dirname, '..', 'server', 'server.js');
  if (fs.existsSync(serverPath)) {
    const { spawn } = require('child_process');
    const serverProcess = spawn('node', [serverPath], {
      cwd: path.join(__dirname, '..', 'server'),
      stdio: 'pipe',
      detached: true,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(Config.SERVER_PORT),
      },
    });
    serverProcess.stdout.on('data', (d) => console.log(`[ModsServer] ${d}`));
    serverProcess.stderr.on('data', (d) => {
      if (d.includes('EADDRINUSE') || d.includes('address already in use')) return;
      console.error(`[ModsServer] ${d}`);
    });
    serverProcess.on('error', (err) => console.error('[ModsServer] Erreur:', err.message));
    app.on('before-quit', () => { try { serverProcess.kill(); } catch {} });
    console.log(`[ModsServer] Démarré sur ${Config.SERVER_URL}`);
  } else {
    console.warn('[ModsServer] server.js introuvable');
  }
}

app.whenReady().then(() => {
  fs.mkdirSync(Config.LAUNCHER_DIR, { recursive: true });

  setupAutoUpdater();
  setupIPC();
  startModsServer();
  createWindow();
  setupLauncher();

  // Vérifier les mises à jour au démarrage (uniquement en production)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (launcher && launcher.isRunning()) {
    console.log('[Launcher] Minecraft en cours d\'exécution — maintien de l\'application en arrière-plan');
    return;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (launcher && launcher.isRunning()) launcher.kill();
});
