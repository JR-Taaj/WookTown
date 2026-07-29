const { app, BrowserWindow } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { Authflow, Titles } = require('prismarine-auth');

const Config = require('./config');

class MinecraftAuth {
  constructor() {
    this.cacheDir = path.join(Config.LAUNCHER_DIR, 'prismarine-cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * Ouvre une popup de connexion Microsoft intégrée.
   */
  async microsoftLoginPopup() {
    // Vider le cache pour forcer une nouvelle connexion
    this._clearCache();

    return new Promise(async (resolve, reject) => {
      let deviceCodeData = null;
      let deviceCodeResolve = null;
      const deviceCodePromise = new Promise(r => { deviceCodeResolve = r; });

      const flow = new Authflow('mc-launcher', this.cacheDir, {
        flow: 'live',
        authTitle: Titles.MinecraftNintendoSwitch,
        forceRefresh: true,
      }, (code) => {
        if (code && code.user_code) {
          deviceCodeResolve({
            userCode: code.user_code,
            verificationUri: code.verification_uri,
          });
        }
      });

      const authPromise = flow.getMinecraftJavaToken({ fetchProfile: true });

      // Attendre le device code
      const deviceCode = await Promise.race([
        deviceCodePromise,
        authPromise.then(() => null, () => null),
        new Promise(r => setTimeout(() => r(null), 10000)),
      ]);

      if (!deviceCode) {
        // Peut-être déjà connecté (token en cache)
        try {
          const mcData = await authPromise;
          if (mcData && mcData.token) {
            return resolve({
              type: 'microsoft',
              username: mcData.profile?.name || mcData.data?.name || 'Player',
              uuid: mcData.profile?.id || mcData.data?.id || crypto.randomUUID(),
              accessToken: mcData.token,
              refreshToken: null,
              profile: mcData.profile || mcData.data,
            });
          }
        } catch {}
        return reject(new Error('Impossible de démarrer la connexion'));
      }

      // Ouvrir la popup
      const popup = new BrowserWindow({
        width: 800,
        height: 700,
        title: 'Connexion Microsoft',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      popup.loadURL(`https://www.microsoft.com/link?otc=${deviceCode.userCode}`);

      popup.on('closed', () => reject(new Error('Connexion annulée')));

      // Attendre la fin de l'auth
      try {
        const mcData = await authPromise;
        if (!popup.isDestroyed()) popup.close();

        resolve({
          type: 'microsoft',
          username: mcData.profile?.name || mcData.data?.name || 'Player',
          uuid: mcData.profile?.id || mcData.data?.id || crypto.randomUUID(),
          accessToken: mcData.token,
          refreshToken: null,
          profile: mcData.profile || mcData.data,
        });
      } catch (err) {
        if (!popup.isDestroyed()) popup.close();
        reject(err);
      }
    });
  }

  _clearCache() {
    try {
      if (fs.existsSync(this.cacheDir)) {
        for (const file of fs.readdirSync(this.cacheDir)) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  //  OFFLINE / CRACKED MODE
  // ═══════════════════════════════════════════════════════════════

  offlineUUID(username) {
    const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  createOfflineSession(username) {
    if (!username || !username.trim()) {
      throw new Error('Pseudo requis pour le mode offline');
    }
    return {
      type: 'crack',
      username: username.trim(),
      uuid: this.offlineUUID(username.trim()),
      accessToken: '0',
    };
  }
}

module.exports = MinecraftAuth;
