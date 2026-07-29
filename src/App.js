import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const electronAPI = window.electronAPI;

const DEFAULT_SETTINGS = {
  username: 'Player',
  minRam: 2048,
  maxRam: 4096,
  width: 1280,
  height: 720,
  javaPath: '',
  gameDir: '',
  jvmArgs: '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M',
  enableFullscreen: false,
  closeLauncherOnPlay: true,
  resolutionMode: 'default',
  useCustomGameDir: false,
};

const RESOLUTION_PRESETS = [
  { label: '854×480', w: 854, h: 480 },
  { label: '1280×720', w: 1280, h: 720 },
  { label: '1920×1080', w: 1920, h: 1080 },
  { label: '2560×1440', w: 2560, h: 1440 },
];

// ─── DOWNLOAD STEPS ──────────────────────────────────────────────

const DOWNLOAD_STEPS = [
  { key: 'preparing', label: 'Préparation du lancement' },
  { key: 'version', label: 'Récupération du manifeste' },
  { key: 'minecraft', label: 'Téléchargement de Minecraft' },
  { key: 'assets', label: 'Vérification des assets' },
  { key: 'libraries', label: 'Téléchargement des librairies' },
  { key: 'fabric', label: 'Installation de Fabric' },
  { key: 'mods', label: 'Téléchargement des mods' },
  { key: 'launching', label: 'Lancement de Minecraft' },
];

function statusToStepKey(status) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes('prépar') || s.includes('prepar')) return 'preparing';
  if (s.includes('manifest') || s.includes('version') || s.includes('metadata')) return 'version';
  if (s.includes('minecraft') || s.includes('jar')) return 'minecraft';
  if (s.includes('asset')) return 'assets';
  if (s.includes('librarie') || s.includes('library')) return 'libraries';
  if (s.includes('fabric')) return 'fabric';
  if (s.includes('mod')) return 'mods';
  if (s.includes('lancement') || s.includes('lanc')) return 'launching';
  return null;
}

function DownloadSteps({ status, percent }) {
  const activeKey = statusToStepKey(status);
  const activeIdx = activeKey
    ? DOWNLOAD_STEPS.findIndex(s => s.key === activeKey)
    : -1;
  if (!status) return null;

  return (
    <div className="download-details">
      {DOWNLOAD_STEPS.map((step, i) => {
        let stepClass = 'download-step pending';
        if (i < activeIdx) stepClass = 'download-step done';
        else if (i === activeIdx) stepClass = 'download-step active';
        const isActive = i === activeIdx;
        const isDone = i < activeIdx;
        let stepIcon = '○';
        if (isDone) stepIcon = '✓';
        else if (isActive) stepIcon = '◉';
        const pct = isActive && percent > 0 ? `${percent}%` : '';

        return (
          <div key={step.key} className={stepClass}>
            <span className="download-step-icon">{stepIcon}</span>
            <span className="download-step-text">{step.label}</span>
            {pct && <span className="download-step-pct">{pct}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── TOAST ────────────────────────────────────────────────────────

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return <div className={`toast ${type}`} onClick={onClose}>{message}</div>;
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = 'info') => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
  }, []);
  const remove = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), []);
  return { toasts, addToast: add, removeToast: remove };
}

function ToastContainer({ toasts, removeToast }) {
  return <div className="toast-container">
    {toasts.map(t => <Toast key={t.id} message={t.msg} type={t.type} onClose={() => removeToast(t.id)} />)}
  </div>;
}

// ─── TITLEBAR ──────────────────────────────────────────────────────

function Titlebar() {
  return (
    <div className="titlebar">
      <div className="titlebar-controls">
        <button className="titlebar-btn close" onClick={() => electronAPI?.closeWindow()} />
        <button className="titlebar-btn minimize" onClick={() => electronAPI?.minimizeWindow()} />
        <button className="titlebar-btn maximize" onClick={() => electronAPI?.maximizeWindow()} />
      </div>
      <div className="titlebar-drag" />
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────

function LoginScreen({ onMicrosoftLogin, onCrackLogin, addToast }) {
  const [crackUsername, setCrackUsername] = useState('');
  const [isMsLogging, setIsMsLogging] = useState(false);

  const handleMicrosoftLogin = async () => {
    if (!electronAPI) return;
    setIsMsLogging(true);
    try {
      const result = await electronAPI.authMicrosoftLogin();
      if (result.success) {
        onMicrosoftLogin(result.session);
        addToast(`Connecté: ${result.session.username}`, 'success');
      } else {
        addToast(`Erreur: ${result.error}`, 'error');
      }
    } catch (err) {
      addToast(`Erreur: ${err.message}`, 'error');
    } finally {
      setIsMsLogging(false);
    }
  };

  const handleCrack = () => {
    if (!crackUsername.trim()) {
      addToast('Entrez un pseudo valide', 'error');
      return;
    }
    electronAPI.authCrack(crackUsername.trim()).then(r => {
      if (r.success) {
        onCrackLogin(r.session);
        addToast(`Mode crack: ${r.session.username}`, 'success');
      } else {
        addToast(`Erreur: ${r.error}`, 'error');
      }
    });
  };

  return (
    <div className="main-panel-content">
      <div className="login-screen">
        <img className="login-logo" src="./logo.png" alt="Logo" />
        <h1 className="login-title">Minecraft Fabric Launcher</h1>
        <p className="login-subtitle">Connecte-toi pour jouer</p>

        <button
          className={`login-ms-btn ${isMsLogging ? 'loading' : ''}`}
          onClick={handleMicrosoftLogin}
          disabled={isMsLogging}
        >
          <span className="login-ms-icon">☁️</span>
          <span className="login-ms-text">
            {isMsLogging ? 'Connexion...' : 'Se connecter avec Microsoft'}
          </span>
        </button>

        <div className="login-divider"><span>ou</span></div>
        <div className="login-crack-row">
          <input
            className="login-crack-input"
            type="text"
            value={crackUsername}
            onChange={e => setCrackUsername(e.target.value)}
            placeholder="Pseudo crack (offline)"
            maxLength={32}
            onKeyDown={e => e.key === 'Enter' && handleCrack()}
          />
          <button className="login-crack-btn" onClick={handleCrack}>
            Jouer en crack
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS MODAL ──────────────────────────────────────────────

function SettingsModal({ settings, updateSetting, gamePaths, onClose, onReset, onVerifyIntegrity, authSession, onLogout, onResetSettings, versions }) {
  const [customGameDir, setCustomGameDir] = useState(settings.useCustomGameDir);

  const handleGameDirToggle = (val) => {
    setCustomGameDir(val);
    updateSetting('useCustomGameDir', val);
    if (!val) updateSetting('gameDir', '');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⚙️ Paramètres</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* ─── Compte ─────────────── */}
          <div className="settings-section">
            <div className="settings-section-title">👤 Compte</div>
            {authSession && (
              <div className="settings-account-info">
                <div className="settings-account-row">
                  <span className="settings-account-type">{authSession.type === 'microsoft' ? '☁️ Microsoft' : '🟢 Crack'}</span>
                  <span className="settings-account-name">{authSession.username}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-danger" onClick={() => { onLogout(); onClose(); }}>Se déconnecter</button>
                </div>
              </div>
            )}
          </div>

          {/* ─── Résolution ─────────────── */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-title">🖥️ Résolution</span>
            </div>
            <div className="presets-row" style={{ marginBottom: 10 }}>
              <button
                className={`preset-btn ${settings.resolutionMode === 'default' ? 'active' : ''}`}
                onClick={() => updateSetting('resolutionMode', 'default')}
              >Par défaut</button>
              <button
                className={`preset-btn ${settings.resolutionMode === 'custom' ? 'active' : ''}`}
                onClick={() => updateSetting('resolutionMode', 'custom')}
              >Personnalisé</button>
              <button
                className={`preset-btn ${settings.resolutionMode === 'fullscreen' ? 'active' : ''}`}
                onClick={() => { updateSetting('resolutionMode', 'fullscreen'); updateSetting('enableFullscreen', true); }}
              >Plein écran</button>
            </div>
            {settings.resolutionMode === 'custom' && (
              <>
                <div className="settings-grid">
                  <div className="input-group">
                    <label className="input-label">Largeur</label>
                    <input className="input-field" type="number" min="800" max="7680" value={settings.width} onChange={e => updateSetting('width', Math.max(800, parseInt(e.target.value) || 800))} />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Hauteur</label>
                    <input className="input-field" type="number" min="480" max="4320" value={settings.height} onChange={e => updateSetting('height', Math.max(480, parseInt(e.target.value) || 480))} />
                  </div>
                </div>
                <div className="presets-row" style={{ marginTop: 8 }}>
                  {RESOLUTION_PRESETS.map(p => (
                    <button key={p.label} className="preset-btn" onClick={() => { updateSetting('width', p.w); updateSetting('height', p.h); }}>{p.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ─── Dossier de données ─────────────── */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-title">📁 Dossier de données</span>
            </div>
            <div className="toggle-group" style={{ marginBottom: 8 }}>
              <label className="toggle">
                <input type="checkbox" checked={customGameDir} onChange={e => handleGameDirToggle(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
              <span className="toggle-label">Dossier personnalisé</span>
            </div>
            {customGameDir && (
              <div className="input-row">
                <input className="input-field" value={settings.gameDir} onChange={e => updateSetting('gameDir', e.target.value)} placeholder="Chemin du dossier de jeu" />
                <button className="btn-icon" onClick={async () => { const r = await electronAPI?.selectFolder(); if (r?.success) updateSetting('gameDir', r.path); }}>📁</button>
              </div>
            )}
            <div className="presets-row" style={{ marginTop: 8 }}>
              {gamePaths && (
                <>
                  <button className="btn-secondary" onClick={() => electronAPI?.openPath(gamePaths.minecraftDir)}>
                    📂 Ouvrir le dossier de jeu
                  </button>
                  <button className="btn-secondary" onClick={() => electronAPI?.openPath(gamePaths.modsDir)}>
                    📂 Dossier mods
                  </button>
                  <button className="btn-secondary" onClick={() => electronAPI?.openPath(gamePaths.logsDir || gamePaths.launcherDir)}>
                    📂 Logs
                  </button>
                </>
              )}
            </div>
            <button className="btn-accent" style={{ marginTop: 10 }} onClick={onVerifyIntegrity}>
              ✓ Vérifier l'intégrité des fichiers
            </button>
          </div>

          {/* ─── Java & Mémoire ─────────── */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-title">☕ Java & Mémoire</span>
            </div>
            <div className="settings-grid">
              <div className="input-group">
                <label className="input-label">Chemin Java</label>
                <div className="input-row">
                  <input className="input-field" value={settings.javaPath} onChange={e => updateSetting('javaPath', e.target.value)} placeholder="Détection automatique" />
                  <button className="btn-icon" onClick={async () => { const r = await electronAPI?.selectJava(); if (r?.success) updateSetting('javaPath', r.path); }}>📁</button>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">RAM max (Mo)</label>
                <input className="input-field" type="number" min="512" max="32768" step="256" value={settings.maxRam} onChange={e => updateSetting('maxRam', Math.max(512, parseInt(e.target.value) || 512))} />
                <span className="input-hint">Recommandé: 4096 Mo</span>
              </div>
              <div className="input-group">
                <label className="input-label">RAM min (Mo)</label>
                <input className="input-field" type="number" min="512" max="32768" step="256" value={settings.minRam} onChange={e => updateSetting('minRam', Math.max(512, parseInt(e.target.value) || 512))} />
              </div>
            </div>
          </div>

          {/* ─── JVM ───────────────── */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-title">⚙️ Arguments JVM</span>
              <button className="btn-icon small" onClick={() => updateSetting('jvmArgs', DEFAULT_SETTINGS.jvmArgs)} title="Réinitialiser">↺</button>
            </div>
            <textarea className="input-textarea" value={settings.jvmArgs} onChange={e => updateSetting('jvmArgs', e.target.value)} placeholder="-XX:+UseG1GC ..." />
            <span className="input-hint">Séparés par des espaces. Valeurs par défaut si vide.</span>
          </div>

          {/* ─── Légal ──────────────── */}
          <div className="settings-section">
            <div className="settings-section-title">⚖️ Mentions légales</div>
            <div className="about-text">
              Minecraft Fabric Launcher v1.1.0<br />
              Minecraft est une marque déposée de Mojang AB.<br />
              Ce launcher n'est pas affilié à Mojang ou Microsoft.<br />
              Fabric {versions?.fabricLoader || '0.16.13'} • Minecraft {versions?.minecraft || '1.20.1'}<br />
              Développé par Sixth
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────

function Sidebar({ authSession, onLogout, onOpenSettings, versions }) {
  return (
    <div className="sidebar">
      <img className="sidebar-logo" src="./logo.png" alt="Logo" />
      <div className="sidebar-title">Minecraft</div>
      <div className="sidebar-subtitle">Fabric {versions?.minecraft || '1.20.1'}</div>

      {authSession && (
        <>
          <div className="sidebar-divider" />
          <div className="sidebar-account">
            <div className="sidebar-avatar">{authSession.type === 'microsoft' ? '☁️' : '🟢'}</div>
            <div className="sidebar-account-info">
              <div className="sidebar-account-name">{authSession.username}</div>
              <div className="sidebar-account-type">{authSession.type === 'microsoft' ? 'Microsoft' : 'Crack'}</div>
            </div>
            <button className="sidebar-logout" onClick={onLogout} title="Se déconnecter">✕</button>
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />

      <button className="sidebar-btn" onClick={onOpenSettings}>
        ⚙️ Paramètres
      </button>
    </div>
  );
}

// ─── MAIN LAUNCHER UI ─────────────────────────────────────────────

function LauncherUI({
  settings, gamePaths, authSession, versions,
  isLoading, isRunning, progress,
  serverOnline, serverChecking,
  onPlay, onStop, onOpenSettings, onLogout, onVerifyIntegrity,
}) {
  const statusText = progress?.status || '';
  const percent = progress?.percent || 0;
  const fl = versions?.fabricLoader || '0.16.13';
  const mc = versions?.minecraft || '1.20.1';

  return (
    <div className="layout">
      <div className="layout-bg" style={{ backgroundImage: `url("./wallpaper.jpg")` }} />
      <Sidebar authSession={authSession} onLogout={onLogout} onOpenSettings={onOpenSettings} versions={versions} />
      <div className="main-panel">
        <div className="main-panel-content">
          <div className="status-row">
            <div className={`server-badge ${serverChecking ? 'checking' : serverOnline ? 'online' : 'offline'}`}>
              <span className={`server-dot ${serverChecking ? 'checking' : serverOnline ? 'online' : 'offline'}`} />
              {serverChecking ? 'Vérification...' : serverOnline ? 'Mods en ligne' : 'Serveur hors ligne'}
            </div>
            <div className="version-badge">
              <span>Fabric {fl}</span> • {mc}
            </div>
          </div>

          <button
            className={`play-btn ${isLoading ? 'loading' : ''} ${isRunning ? 'is-running' : ''}`}
            onClick={isLoading || isRunning ? undefined : onPlay}
            disabled={isLoading || isRunning}
          >
            <div className="play-btn-icon">{!isLoading && !isRunning ? '▶' : ''}</div>
            <div className="play-btn-label">
              <span className="play-btn-title">
                {isLoading ? 'Téléchargement...' : isRunning ? 'En jeu' : 'Jouer'}
              </span>
              <span className="play-btn-sub">
                {isLoading ? 'Préparation en cours...' : isRunning ? 'Minecraft est ouvert' : `Fabric ${mc}`}
              </span>
            </div>
          </button>

          {(isLoading || isRunning) && (
            <div className="progress-container">
              <div className="progress-status">{statusText}</div>
              <div className="progress-track">
                <div
                  className={`progress-fill ${percent === 0 && isLoading ? 'indeterminate' : ''}`}
                  style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                />
              </div>
              {isLoading && <DownloadSteps status={statusText} percent={percent} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────

function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ status: '', percent: 0 });
  const [serverOnline, setServerOnline] = useState(false);
  const [serverChecking, setServerChecking] = useState(true);
  const [gamePaths, setGamePaths] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [authSession, setAuthSession] = useState(null);
  const [versions, setVersions] = useState({ fabricLoader: '0.16.10', minecraft: '1.20.1' });
  const { toasts, addToast, removeToast } = useToasts();
  const checkRef = useRef(null);

  // ─── Init ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!electronAPI) return;
      const saved = await electronAPI.loadConfig();
      if (saved && Object.keys(saved).length > 0) setSettings(p => ({ ...p, ...saved }));
      const paths = await electronAPI.getPaths();
      setGamePaths(paths);
      const sess = await electronAPI.authGetSession();
      if (sess.success && sess.session) {
        setAuthSession(sess.session);
        if (sess.session.type === 'microsoft') setSettings(p => ({ ...p, username: sess.session.username }));
      }
      // Récupérer les versions depuis le processus main
      const v = await electronAPI.getVersions();
      if (v) setVersions(v);
    })();
  }, []);

  // ─── Server check ──────────────────────────────────────────
  useEffect(() => {
    let serverUrl = 'http://127.0.0.1:8080'; // fallback
    const check = async () => {
      setServerChecking(true);
      try {
        const resp = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
        setServerOnline(resp.ok);
      } catch { setServerOnline(false); }
      setServerChecking(false);
    };
    // Get server URL from backend config
    if (electronAPI?.getServerUrl) {
      electronAPI.getServerUrl().then(url => {
        if (url) serverUrl = url;
        check();
      }).catch(() => check());
    } else {
      check();
    }
    checkRef.current = setInterval(check, 30000);
    return () => { if (checkRef.current) clearInterval(checkRef.current); };
  }, []);

  // ─── IPC listeners ─────────────────────────────────────────
  useEffect(() => {
    if (!electronAPI) return;
    const unsub1 = electronAPI.onDownloadProgress(d => setProgress(d));
    const unsub2 = electronAPI.onGameExited(d => {
      setIsLoading(false); setIsRunning(false);
      setProgress({ status: `Fermé (code: ${d.code})`, percent: 100 });
      addToast(`Minecraft fermé (code: ${d.code})`, 'info');
    });
    return () => { unsub1?.(); unsub2?.(); };
  }, [addToast]);

  const updateSetting = useCallback((key, val) => {
    setSettings(p => {
      const next = { ...p, [key]: val };
      if (electronAPI) electronAPI.saveConfig(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    if (electronAPI) electronAPI.saveConfig(DEFAULT_SETTINGS);
    addToast('Paramètres réinitialisés', 'info');
  }, [addToast]);

  // ─── Auth handlers ─────────────────────────────────────────
  const handleMicrosoftLogin = useCallback((session) => {
    setAuthSession(session);
    setSettings(p => ({ ...p, username: session.username }));
  }, []);

  const handleCrackLogin = useCallback((session) => {
    setAuthSession(session);
    setSettings(p => ({ ...p, username: session.username }));
  }, []);

  const handleLogout = useCallback(async () => {
    if (electronAPI) await electronAPI.authLogout();
    setAuthSession(null);
    setSettings(p => ({ ...p, username: DEFAULT_SETTINGS.username }));
    addToast('Déconnecté', 'info');
  }, [addToast]);

  // ─── Verify integrity ──────────────────────────────────────
  const handleVerifyIntegrity = useCallback(() => {
    addToast('Vérification de l\'intégrité en cours...', 'info');
    // Trigger a re-download check by clearing cached state? 
    // For now just a toast - the real check happens on next launch
    electronAPI?.launchMinecraft({ verifyOnly: true }).catch(() => {});
  }, [addToast]);

  // ─── Play ──────────────────────────────────────────────────
  const handlePlay = async () => {
    if (!electronAPI || isLoading || isRunning || !authSession) return;

    // Timeout de sécurité : si après 5 minutes le lancement n'a pas fini, on reset
    const timeoutId = setTimeout(() => {
      setIsLoading(false);
      setProgress({ status: 'Délai dépassé', percent: 0 });
      addToast('Le lancement a pris trop de temps', 'error');
    }, 300000);

    let useFullscreen = settings.enableFullscreen;
    let playWidth = settings.width;
    let playHeight = settings.height;

    if (settings.resolutionMode === 'default') {
      playWidth = DEFAULT_SETTINGS.width;
      playHeight = DEFAULT_SETTINGS.height;
      useFullscreen = false;
    } else if (settings.resolutionMode === 'fullscreen') {
      useFullscreen = true;
    }

    setIsLoading(true);
    setProgress({ status: 'Préparation du lancement...', percent: 0 });

    try {
      const r = await electronAPI.launchMinecraft({
        username: authSession.username,
        uuid: authSession?.uuid || '',
        accessToken: authSession?.accessToken || '',
        minRam: settings.minRam,
        maxRam: settings.maxRam,
        width: playWidth,
        height: playHeight,
        javaPath: settings.javaPath,
        gameDir: settings.useCustomGameDir ? settings.gameDir : '',
        jvmArgs: settings.jvmArgs ? settings.jvmArgs.split(/\s+/).filter(Boolean) : [],
        fullscreen: useFullscreen,
        closeOnLaunch: true,
      });
      if (r.success) {
        setIsRunning(true);
        addToast('Minecraft est lancé !', 'success');
        // Fermer le launcher après le lancement
        setTimeout(() => electronAPI?.closeWindow(), 500);
      } else {
        addToast(`Erreur: ${r.error}`, 'error');
        setProgress({ status: `Erreur: ${r.error}`, percent: 0 });
        setIsLoading(false);
      }
    } catch (err) {
      addToast(`Erreur: ${err.message}`, 'error');
      setIsLoading(false);
    }
  };

  const handleStop = useCallback(() => {
    electronAPI?.killMinecraft();
  }, []);

  return (
    <div className="app-container">
      <Titlebar />
      {authSession ? (
        <LauncherUI
          settings={settings}
          gamePaths={gamePaths}
          authSession={authSession}
          versions={versions}
          isLoading={isLoading}
          isRunning={isRunning}
          progress={progress}
          serverOnline={serverOnline}
          serverChecking={serverChecking}
          onPlay={handlePlay}
          onStop={handleStop}
          onOpenSettings={() => setShowSettings(true)}
          onLogout={handleLogout}
          onVerifyIntegrity={handleVerifyIntegrity}
        />
      ) : (
        <div className="layout">
          <div className="layout-bg" style={{ backgroundImage: `url("./wallpaper.jpg")` }} />
          <div className="sidebar">
            <img className="sidebar-logo" src="./logo.png" alt="Logo" />
            <div className="sidebar-title">Minecraft</div>
            <div className="sidebar-subtitle">Fabric {versions?.minecraft || '1.20.1'}</div>
          </div>
          <div className="main-panel">
            <LoginScreen
              onMicrosoftLogin={handleMicrosoftLogin}
              onCrackLogin={handleCrackLogin}
              addToast={addToast}
            />
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          updateSetting={updateSetting}
          gamePaths={gamePaths}
          authSession={authSession}
          versions={versions}
          onClose={() => setShowSettings(false)}
          onReset={resetSettings}
          onVerifyIntegrity={handleVerifyIntegrity}
          onLogout={() => { handleLogout(); setShowSettings(false); }}
        />
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

export default App;
