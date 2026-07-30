const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const axios = require('axios');
const AdmZip = require('adm-zip');

const Config = require('./config');

class MinecraftLauncher {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.minecraftProcess = null;
    this.axiosInstance = axios.create({
      timeout: 60000,
      headers: { 'User-Agent': 'MinecraftLauncher/1.0' },
    });
    this._validateDirs();
  }

  _validateDirs() {
    const dirs = [
      Config.MINECRAFT_DIR, Config.VERSIONS_DIR, Config.MODS_DIR,
      Config.ASSETS_DIR, Config.LIBRARIES_DIR, Config.NATIVES_DIR,
      Config.LOGS_DIR, Config.CACHE_DIR, Config.RUNTIME_DIR,
    ];
    dirs.forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch {} });
  }

  _sendProgress(status, percent = 0) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('download-progress', { status, percent });
    }
  }

  _downloadFile(url, dest, expectedHash = '') {
    return new Promise(async (resolve, reject) => {
      const destPath = path.resolve(dest);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      // Skip si existe et hash valide
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        if (expectedHash) {
          const actualHash = this._sha256(destPath);
          if (actualHash === expectedHash.toLowerCase()) return resolve();
        } else {
          // Si le fichier fait plus de 1KB, on suppose qu'il est bon (pas de hash)
          if (fs.statSync(destPath).size > 1024) return resolve();
        }
      }

      try {
        const response = await this.axiosInstance({
          method: 'GET',
          url,
          responseType: 'stream',
          timeout: 120000, // 2 min pour les gros fichiers
        });

        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const writer = fs.createWriteStream(destPath);

        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            this._sendProgress(`Téléchargement: ${path.basename(destPath)}`, pct);
          }
        });

        response.data.pipe(writer);

        writer.on('finish', () => {
          if (fs.statSync(destPath).size === 0) {
            try { fs.unlinkSync(destPath); } catch {}
            return reject(new Error(`Fichier vide: ${path.basename(destPath)}`));
          }
          if (expectedHash) {
            const actualHash = this._sha256(destPath);
            if (actualHash !== expectedHash.toLowerCase()) {
              try { fs.unlinkSync(destPath); } catch {}
              return reject(new Error(`Hash mismatch pour ${path.basename(destPath)}`));
            }
          }
          resolve();
        });

        writer.on('error', (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });

        response.data.on('error', (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
      } catch (err) {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        reject(err);
      }
    });
  }

  _sha256(filePath) {
    try {
      const data = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
    } catch { return ''; }
  }

  _sha1(filePath) {
    try {
      const data = fs.readFileSync(filePath);
      return crypto.createHash('sha1').update(data).digest('hex').toLowerCase();
    } catch { return ''; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  VERSION MANIFEST
  // ═══════════════════════════════════════════════════════════════

  async _getVersionManifest() {
    this._sendProgress('Récupération du manifeste des versions...', 0);
    const resp = await this.axiosInstance.get(Config.MINECRAFT_MANIFEST, { timeout: 15000 });
    return resp.data;
  }

  async _getVersionMeta(version = Config.MINECRAFT_VERSION) {
    const manifest = await this._getVersionManifest();
    const ver = manifest.versions.find(v => v.id === version);
    if (!ver) throw new Error(`Version ${version} introuvable dans le manifeste`);
    this._sendProgress(`Récupération des métadonnées de ${version}...`, 0);
    const resp = await this.axiosInstance.get(ver.url, { timeout: 15000 });
    return resp.data;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TÉLÉCHARGEMENT MINECRAFT
  // ═══════════════════════════════════════════════════════════════

  async _downloadMinecraftJar(versionMeta) {
    const jarUrl = versionMeta?.downloads?.client?.url;
    if (!jarUrl) throw new Error('URL du client Minecraft introuvable');
    const expectedSha1 = versionMeta?.downloads?.client?.sha1 || '';

    const versionDir = path.join(Config.VERSIONS_DIR, Config.MINECRAFT_VERSION);
    fs.mkdirSync(versionDir, { recursive: true });
    const jarPath = path.join(versionDir, `${Config.MINECRAFT_VERSION}.jar`);

    this._sendProgress(`Téléchargement de Minecraft ${Config.MINECRAFT_VERSION}...`, 0);

    // Vérifier le JAR existant
    if (fs.existsSync(jarPath) && expectedSha1) {
      const actualSha1 = this._sha1(jarPath);
      if (actualSha1 === expectedSha1.toLowerCase()) {
        this._sendProgress(`Minecraft ${Config.MINECRAFT_VERSION} déjà à jour.`, 10);
        return jarPath;
      }
    }

    await this._downloadFile(jarUrl, jarPath);

    // Vérification after download
    if (expectedSha1) {
      const actualSha1 = this._sha1(jarPath);
      if (actualSha1 !== expectedSha1.toLowerCase()) {
        try { fs.unlinkSync(jarPath); } catch {}
        throw new Error(`Le JAR de Minecraft téléchargé est corrompu (SHA1 mismatch)`);
      }
    }

    return jarPath;
  }

  async _downloadVersionJson(versionMeta) {
    const versionDir = path.join(Config.VERSIONS_DIR, Config.MINECRAFT_VERSION);
    fs.mkdirSync(versionDir, { recursive: true });
    const jsonPath = path.join(versionDir, `${Config.MINECRAFT_VERSION}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(versionMeta, null, 2));
    return jsonPath;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ASSETS
  // ═══════════════════════════════════════════════════════════════

  async _downloadAssets(versionMeta) {
    const assetIndex = versionMeta?.assetIndex || {};
    const assetUrl = assetIndex.url;
    const assetSha1 = assetIndex.sha1 || '';
    if (!assetUrl) throw new Error('Index des assets introuvable');

    const indexDir = path.join(Config.CACHE_DIR, 'assets', 'indexes');
    fs.mkdirSync(indexDir, { recursive: true });
    const indexPath = path.join(indexDir, `${Config.MINECRAFT_VERSION}.json`);

    // Télécharger/index si nécessaire
    if (fs.existsSync(indexPath) && assetSha1) {
      if (this._sha1(indexPath) !== assetSha1.toLowerCase()) {
        this._sendProgress('Mise à jour de l\'index des assets...', 0);
        await this._downloadFile(assetUrl, indexPath);
      }
    } else if (!fs.existsSync(indexPath)) {
      this._sendProgress('Téléchargement de l\'index des assets...', 0);
      await this._downloadFile(assetUrl, indexPath);
    }

    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const objects = indexData.objects || {};
    const entries = Object.entries(objects);
    const assetsRoot = path.join(Config.CACHE_DIR, 'assets');
    const objectsDir = path.join(assetsRoot, 'objects');

    this._sendProgress(`Vérification de ${entries.length} assets...`, 0);

    // Trouver les assets manquants
    const missing = [];
    for (const [objPath, objInfo] of entries) {
      const objHash = objInfo.hash;
      const prefix = objHash.substring(0, 2);
      const objFile = path.join(objectsDir, prefix, objHash);
      if (!fs.existsSync(objFile)) {
        missing.push({ objPath, objInfo, objHash, prefix, objFile });
      }
    }

    if (missing.length === 0) {
      this._sendProgress('Tous les assets sont à jour.', 100);
      return;
    }

    this._sendProgress(`Téléchargement de ${missing.length} assets manquants...`, 0);
    let done = 0;
    const batchSize = 6; // 6 téléchargements en parallèle

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const promises = batch.map(m => {
        const url = `${Config.MINECRAFT_RESOURCES}/${m.prefix}/${m.objHash}`;
        fs.mkdirSync(path.dirname(m.objFile), { recursive: true });
        return this._downloadFile(url, m.objFile).catch(() => {});
      });
      await Promise.all(promises);
      done += batch.length;
      this._sendProgress(`Assets: ${done}/${missing.length}`, Math.round((done / missing.length) * 100));
    }

    // Créer le dossier virtual/legacy pour compatibilité
    const virtualDir = path.join(assetsRoot, 'virtual', 'legacy');
    let virtualDone = 0;
    for (const [objPath, objInfo] of entries) {
      const objHash = objInfo.hash;
      const prefix = objHash.substring(0, 2);
      const src = path.join(objectsDir, prefix, objHash);
      const dst = path.join(virtualDir, objPath);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        try { fs.copyFileSync(src, dst); } catch {}
      }
      virtualDone++;
      if (virtualDone % 500 === 0) {
        this._sendProgress(`Assets: création virtual/legacy...`, 95);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIBRARIES
  // ═══════════════════════════════════════════════════════════════

  _parseLibraryName(libName) {
    const parts = libName.split(':');
    if (parts.length >= 3) {
      return { group: parts[0].replace(/\./g, '/'), name: parts[1], version: parts[2] };
    }
    return null;
  }

  _getLibraryPath(lib) {
    const parsed = this._parseLibraryName(lib.name);
    if (!parsed) return null;
    return path.join(Config.LIBRARIES_DIR, parsed.group, parsed.name, parsed.version, `${parsed.name}-${parsed.version}.jar`);
  }

  _getLibraryDownloadUrl(lib) {
    const parsed = this._parseLibraryName(lib.name);
    if (!parsed) return null;
    const jarName = `${parsed.name}-${parsed.version}.jar`;
    const libUrl = lib.url || Config.MINECRAFT_LIBRARIES;
    return `${libUrl}/${parsed.group}/${parsed.name}/${parsed.version}/${jarName}`;
  }

  _isLibraryAllowed(lib) {
    const rules = lib.rules || [];
    if (rules.length === 0) return true;
    let allowed = false;
    for (const rule of rules) {
      const action = rule.action || 'disallow';
      const osRule = rule.os || {};
      if (!osRule || Object.keys(osRule).length === 0) {
        if (action === 'allow') allowed = true;
        else if (action === 'disallow') allowed = false;
        continue;
      }
      let osName = osRule.name || '';
      if (osName === 'osx' || osName === 'macos') osName = 'darwin';
      if (osName === 'windows') osName = 'win';
      if (process.platform.startsWith(osName)) {
        allowed = (action === 'allow');
      }
    }
    return allowed;
  }

  _getNativeExtractDir() {
    const nativeDir = path.join(Config.NATIVES_DIR, `natives-${Date.now()}`);
    fs.mkdirSync(nativeDir, { recursive: true });
    this._cleanOldNatives();
    return nativeDir;
  }

  _cleanOldNatives() {
    const base = Config.NATIVES_DIR;
    if (!fs.existsSync(base)) return;
    const dirs = fs.readdirSync(base)
      .filter(d => d.startsWith('natives-'))
      .sort();
    // Garder les 5 plus récents seulement
    if (dirs.length > 5) {
      dirs.slice(0, dirs.length - 5).forEach(d => {
        try { fs.rmSync(path.join(base, d), { recursive: true }); } catch {}
      });
    }
  }

  async _downloadLibraries(versionMeta, nativeExtractDir) {
    const libraries = versionMeta.libraries || [];
    this._sendProgress(`Téléchargement de ${libraries.length} librairies...`, 0);

    const toDownload = [];
    const nativeJars = new Set();

    for (const lib of libraries) {
      if (!this._isLibraryAllowed(lib)) continue;

      const parsed = this._parseLibraryName(lib.name);
      if (!parsed) {
        // Pas de nom parsable, essayer avec downloads.artifact
        if (lib.downloads?.artifact) {
          const jarPath = path.resolve(Config.LIBRARIES_DIR, '..', lib.downloads.artifact.path || '');
          if (jarPath && !fs.existsSync(jarPath)) {
            fs.mkdirSync(path.dirname(jarPath), { recursive: true });
            toDownload.push({ url: lib.downloads.artifact.url, path: jarPath });
          }
        }
        continue;
      }

      // Téléchargement principal (artifact)
      let mainJarPath = null;
      if (lib.downloads?.artifact) {
        mainJarPath = path.join(Config.LIBRARIES_DIR, lib.downloads.artifact.path || '');
        // Fallback au path standard si le path de l'artifact est relatif
        if (!path.isAbsolute(mainJarPath)) {
          mainJarPath = path.resolve(Config.LIBRARIES_DIR, lib.downloads.artifact.path);
        }
        if (!mainJarPath || !mainJarPath.startsWith(Config.LIBRARIES_DIR)) {
          mainJarPath = this._getLibraryPath(lib);
        }
      } else {
        mainJarPath = this._getLibraryPath(lib);
      }

      if (mainJarPath && !fs.existsSync(mainJarPath)) {
        fs.mkdirSync(path.dirname(mainJarPath), { recursive: true });
        let jarUrl = lib.downloads?.artifact?.url || this._getLibraryDownloadUrl(lib);
        if (jarUrl) {
          toDownload.push({ url: jarUrl, path: mainJarPath });
        }
      }

      // Natives - extraire TOUS les natives existants ou à télécharger
      const nativeKey = lib.natives?.windows || lib.natives?.osx || lib.natives?.linux;
      if (nativeKey && lib.downloads?.classifiers?.[nativeKey]) {
        const dl = lib.downloads.classifiers[nativeKey];
        const jarName = `${parsed.name}-${parsed.version}-${nativeKey}.jar`;
        const nativeJarPath = path.join(Config.LIBRARIES_DIR, parsed.group, parsed.name, parsed.version, jarName);

        if (!fs.existsSync(nativeJarPath)) {
          fs.mkdirSync(path.dirname(nativeJarPath), { recursive: true });
          toDownload.push({ url: dl.url, path: nativeJarPath, isNative: true });
        }
        // Même si déjà téléchargé, on l'ajoute pour extraction
        if (fs.existsSync(nativeJarPath)) nativeJars.add(nativeJarPath);
      }

      // Aussi chercher les natives-windows dans les classifiers
      if (lib.downloads?.classifiers && parsed) {
        const nativeKeys = Object.keys(lib.downloads.classifiers).filter(k => k.includes('natives-windows'));
        for (const nk of nativeKeys) {
          const dl = lib.downloads.classifiers[nk];
          const jarName = `${parsed.name}-${parsed.version}-${nk}.jar`;
          const nativeJarPath = path.join(Config.LIBRARIES_DIR, parsed.group, parsed.name, parsed.version, jarName);
          if (!fs.existsSync(nativeJarPath)) {
            fs.mkdirSync(path.dirname(nativeJarPath), { recursive: true });
            toDownload.push({ url: dl.url, path: nativeJarPath, isNative: true });
          }
          if (fs.existsSync(nativeJarPath)) nativeJars.add(nativeJarPath);
        }
      }
    }

    // Télécharger les fichiers manquants
    if (toDownload.length > 0) {
      this._sendProgress(`Téléchargement des librairies...`, 0);
      let done = 0;
      const total = toDownload.length;
      for (let i = 0; i < toDownload.length; i += 6) {
        const batch = toDownload.slice(i, i + 6);
        await Promise.all(batch.map(item =>
          this._downloadFile(item.url, item.path).catch(err => {
            console.error(`[!] Erreur librairie ${path.basename(item.path)}:`, err.message);
          })
        ));
        // Ajouter les natives téléchargés
        for (const item of batch) {
          if (item.isNative && fs.existsSync(item.path)) nativeJars.add(item.path);
        }
        done += batch.length;
        this._sendProgress(`Libraries: ${done}/${total}`, Math.round((done / total) * 100));
      }
    } else {
      this._sendProgress('Librairies vérifiées.', 100);
    }

    // Extraction des natives (TOUS, pas seulement ceux téléchargés maintenant)
    this._sendProgress('Extraction des natives...', 95);
    const nativeJarsArray = [...nativeJars];
    for (let i = 0; i < nativeJarsArray.length; i++) {
      this._extractNative(nativeJarsArray[i], nativeExtractDir);
      if (i % 5 === 0) {
        this._sendProgress(`Natives: ${i + 1}/${nativeJarsArray.length}`, 95);
      }
    }
  }

  _extractNative(nativeJar, destDir) {
    if (!fs.existsSync(nativeJar)) return;
    try {
      const zip = new AdmZip(nativeJar);
      const entries = zip.getEntries();
      let extracted = 0;
      for (const entry of entries) {
        const en = entry.entryName;
        // Extraire les DLLs et les libs natives
        if (en.endsWith('.dll') || en.endsWith('.so') || en.endsWith('.dylib') || en.endsWith('.jnilib')) {
          try {
            zip.extractEntryTo(entry, destDir, false, true);
            extracted++;
          } catch (e) {
            // Ignorer les erreurs d'extraction individuelles
          }
        }
      }
      if (extracted > 0) {
        console.log(`[Natives] ${extracted} fichier(s) extrait(s) de ${path.basename(nativeJar)}`);
      }
    } catch (err) {
      console.error(`[!] Erreur extraction ${path.basename(nativeJar)}:`, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  FABRIC
  // ═══════════════════════════════════════════════════════════════

  async _installFabricProfile() {
    const versionName = `fabric-loader-${Config.FABRIC_LOADER_VERSION}-${Config.MINECRAFT_VERSION}`;
    const versionDir = path.join(Config.VERSIONS_DIR, versionName);
    fs.mkdirSync(versionDir, { recursive: true });

    const jarPath = path.join(versionDir, `${versionName}.jar`);
    const jsonPath = path.join(versionDir, `${versionName}.json`);

    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${Config.MINECRAFT_VERSION}/${Config.FABRIC_LOADER_VERSION}/profile/json`;
    this._sendProgress('Téléchargement du profil Fabric...', 0);

    let profile;
    try {
      const resp = await this.axiosInstance.get(profileUrl, { timeout: 15000 });
      profile = resp.data;
    } catch (err) {
      throw new Error(`Impossible de récupérer le profil Fabric (${Config.FABRIC_LOADER_VERSION}): ${err.message}`);
    }

    fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));

    // Télécharger le JAR du loader Fabric (pas dans les libraries, c'est notre "version" JAR)
    const loaderDownload = profile.downloads?.loader;
    if (loaderDownload?.url) {
      if (!fs.existsSync(jarPath)) {
        this._sendProgress('Téléchargement du Fabric Loader...', 50);
        await this._downloadFile(loaderDownload.url, jarPath);
      } else if (loaderDownload.sha1) {
        const actualSha1 = this._sha1(jarPath);
        if (actualSha1 !== loaderDownload.sha1.toLowerCase()) {
          this._sendProgress('Mise à jour du Fabric Loader...', 50);
          await this._downloadFile(loaderDownload.url, jarPath);
        }
      }
    } else {
      // Fallback
      if (!fs.existsSync(jarPath)) {
        this._sendProgress('Téléchargement du Fabric Loader...', 50);
        await this._downloadFile(Config.FABRIC_LOADER_URL, jarPath);
      }
    }

    // Nettoyer les anciennes versions de fabric-loader du cache
    // pour éviter qu'une version obsolète soit chargée sur le classpath
    this._cleanOldFabricLoaderVersions();

    // Librairies Fabric (nécessaires car le loader JAR ne les inclut pas)
    const libs = profile.libraries || [];
    if (libs.length > 0) {
      this._sendProgress(`Librairies Fabric: ${libs.length}...`, 60);
      for (const lib of libs) {
        if (!this._isLibraryAllowed(lib)) continue;

        // NE PAS télécharger les intermédiaires (inclus dans le version JAR Fabric)
        if (lib.name && lib.name.includes(':intermediaries')) continue;
        // ATTENTION: depuis Fabric 0.15+, le mainClass (KnotClient) est dans la library
        // net.fabricmc:fabric-loader (dans libraries/), PAS dans le version JAR.
        // Donc on DOIT télécharger cette library.
        // On ne skip QUE si le fichier existe déjà (vérifié plus bas).

        const parsed = this._parseLibraryName(lib.name);
        if (!parsed) continue;

        const libPath = path.join(Config.LIBRARIES_DIR, parsed.group, parsed.name, parsed.version, `${parsed.name}-${parsed.version}.jar`);
        if (fs.existsSync(libPath)) continue;

        let libUrl = null;
        if (lib.downloads?.artifact?.url) {
          libUrl = lib.downloads.artifact.url;
        } else if (lib.url) {
          const jarName = `${parsed.name}-${parsed.version}.jar`;
          libUrl = `${lib.url}${parsed.group}/${parsed.name}/${parsed.version}/${jarName}`;
        }
        if (!libUrl) continue;

        fs.mkdirSync(path.dirname(libPath), { recursive: true });
        try { await this._downloadFile(libUrl, libPath); } catch (e) {
          console.error(`[!] Erreur lib Fabric ${lib.name}:`, e.message);
        }
      }
    }
    this._sendProgress('Fabric installé !', 80);
    return { versionName, jarPath, jsonPath, profile, mainClass: profile.mainClass };
  }

  async _downloadMods() {
    this._sendProgress('Récupération de la liste des mods...', 0);
    fs.mkdirSync(Config.MODS_DIR, { recursive: true });

    let modsList;
    // Essayer d'abord le serveur LOCAL (127.0.0.1:8080)
    // Si ça échoue, essayer le serveur DISTANT (90.35.92.246:8080)
    try {
      const localResp = await this.axiosInstance.get(Config.LOCAL_MODS_LIST_URL, { timeout: 3000 });
      modsList = localResp.data;
      console.log('[Mods] Utilisation du serveur LOCAL (127.0.0.1:8080)');
    } catch (localErr) {
      console.log('[Mods] Serveur local indisponible, tentative distante...');
      try {
        const remoteResp = await this.axiosInstance.get(Config.MODS_LIST_URL, { timeout: 5000 });
        modsList = remoteResp.data;
        console.log('[Mods] Utilisation du serveur DISTANT (90.35.92.246:8080)');
      } catch (remoteErr) {
        this._sendProgress('Serveur de mods non disponible.', 0);
        console.error('[!] Erreur serveur mods (local et distant):', remoteErr.message);
        return [];
      }
    }

    if (!modsList || !Array.isArray(modsList) || modsList.length === 0) {
      this._sendProgress('Aucun mod configuré sur le serveur.', 0);
      return [];
    }

    // Supprimer TOUS les mods existants avant de re-télécharger
    this._sendProgress('Nettoyage des mods existants...', 0);
    for (const f of fs.readdirSync(Config.MODS_DIR)) {
      if (f.endsWith('.jar')) {
        try { fs.unlinkSync(path.join(Config.MODS_DIR, f)); } catch {}
      }
    }

    this._sendProgress(`Téléchargement de ${modsList.length} mod(s)...`, 0);
    let downloaded = 0;

    for (let i = 0; i < modsList.length; i++) {
      const mod = modsList[i];
      const filename = mod.filename || '';
      const url = mod.url || '';
      const expectedSha256 = (mod.sha256 || '').toLowerCase();
      const dest = path.join(Config.MODS_DIR, filename);
      if (!filename || !url) continue;

      try {
        await this._downloadFile(url, dest, expectedSha256);
        downloaded++;
      } catch (err) {
        console.error(`[!] Erreur téléchargement mod ${filename}:`, err.message);
      }
      this._sendProgress(`Mods: ${i + 1}/${modsList.length}`, Math.round(((i + 1) / modsList.length) * 100));
    }

    this._sendProgress(
      `Mods: ${downloaded} téléchargé(s)`,
      100
    );

    return modsList.filter(m => m.filename).map(m => path.join(Config.MODS_DIR, m.filename)).filter(f => fs.existsSync(f));
  }

  // ═══════════════════════════════════════════════════════════════
  //  JAVA
  // ═══════════════════════════════════════════════════════════════

  _getJavaVersion(javaPath) {
    try {
      const out = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf8', timeout: 5000 });
      const match = out.match(/(?:version\s+"?)(\d+)/);
      if (match) return parseInt(match[1], 10);
    } catch {}
    return 0;
  }

  async _ensureEmbeddedJava() {
    const javaPath = Config.BUNDLED_JAVA_PATH;
    if (fs.existsSync(javaPath)) {
      const ver = this._getJavaVersion(javaPath);
      if (ver >= Config.JAVA_MINIMUM_VERSION) return javaPath;
      try { fs.rmSync(Config.BUNDLED_JRE_DIR, { recursive: true }); } catch {}
    }

    const zipPath = path.join(Config.CACHE_DIR, 'jre21.zip');
    this._sendProgress('Téléchargement de Java 21 (JRE portable)...', 0);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });

    try {
      await this._downloadFile(Config.JAVA_DOWNLOAD_URL, zipPath, Config.JAVA_DOWNLOAD_SHA256);
    } catch (err) {
      throw new Error(`Impossible de télécharger Java 21: ${err.message}. Installez Java manuellement.`);
    }

    this._sendProgress('Extraction de Java...', 85);
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(Config.RUNTIME_DIR, true);
    } catch (err) {
      // Fallback avec extract-zip
      try {
        const extractZip = require('extract-zip');
        await extractZip(zipPath, { dir: Config.RUNTIME_DIR });
      } catch (e2) {
        throw new Error(`Impossible d'extraire Java: ${e2.message}`);
      }
    }

    try { fs.unlinkSync(zipPath); } catch {}

    // Chercher javaw.exe ou java.exe dans le répertoire extrait
    const javaExes = this._findJavaInDir(Config.RUNTIME_DIR);
    for (const exe of javaExes) {
      const ver = this._getJavaVersion(exe);
      if (ver >= Config.JAVA_MINIMUM_VERSION) {
        this._sendProgress(`Java ${ver} prêt !`, 100);
        return exe;
      }
    }

    throw new Error('Java a été extrait mais le binaire est introuvable. Installez Java manuellement.');
  }

  _findJavaInDir(dir, results = []) {
    try {
      for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (item === 'bin') {
              const jw = path.join(full, 'javaw.exe');
              if (fs.existsSync(jw)) results.push(jw);
              const je = path.join(full, 'java.exe');
              if (fs.existsSync(je)) results.push(je);
            } else {
              this._findJavaInDir(full, results);
            }
          }
        } catch {}
      }
    } catch {}
    return results;
  }

  _getLatestLogPath() {
    const logDir = Config.LOGS_DIR;
    fs.mkdirSync(logDir, { recursive: true });
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
    return path.join(logDir, `launcher-${ts}.log`);
  }

  // ═══════════════════════════════════════════════════════════════
  //  ARG FILE (évite la limite Windows de 8191 caractères)
  // ═══════════════════════════════════════════════════════════════

  _createClasspathJar(jarPaths) {
    // Crée un JAR avec un manifest Class-Path listant tous les JARs du classpath.
    // Cela évite la limite Windows de 8191 caractères sur la ligne de commande.
    // On passe ce JAR unique en -cp, Java suit les références Class-Path automatiquement.
    const cpDir = path.join(Config.CACHE_DIR, 'classpath');
    fs.mkdirSync(cpDir, { recursive: true });
    const jarPath = path.join(cpDir, `cp-${Date.now()}.jar`);

    // Nettoyer les vieux classpath jars
    try {
      for (const f of fs.readdirSync(cpDir)) {
        if (f.startsWith('cp-')) {
          try { fs.unlinkSync(path.join(cpDir, f)); } catch {}
        }
      }
    } catch {}

    // Le manifest Class-Path attend des chemins absolus (séparateur = espace).
    // Sur Windows, utiliser des / (comme Java le supporte), et NE PAS
    // inclure de chemins avec espaces (l'espace est le délimiteur entre entrées).
    // Les chemins du launcher ne contiennent pas d'espaces (AppData/Roaming).
    const classPathEntries = jarPaths.map(jp => {
      // Convertir les \ en / pour la portabilité
      const normalized = jp.replace(/\\/g, '/');
      // Normaliser le format : C:/Users/... au lieu de file:///C:/Users/...
      return normalized;
    }).join(' ');

    const manifestContent = `Manifest-Version: 1.0\r\nClass-Path: ${classPathEntries}\r\n\r\n`;

    // Créer le JAR avec AdmZip
    const zip = new AdmZip();
    zip.addFile('META-INF/MANIFEST.MF', Buffer.from(manifestContent, 'utf-8'));
    zip.writeZip(jarPath);

    console.log(`[Launcher] Classpath JAR créé: ${jarPath} (${jarPaths.length} entrées)`);
    return jarPath;
  }

  _writeArgFile(args) {
    const argDir = path.join(Config.CACHE_DIR, 'args');
    fs.mkdirSync(argDir, { recursive: true });
    const argFilePath = path.join(argDir, `args-${Date.now()}.txt`);

    // Java argfile : chaque ligne = un argument.
    // Si un argument contient des espaces, on doit l'entourer de guillemets doubles.
    // Java lit le fichier, enlève les guillemets extérieurs, et passe l'argument.
    // Les backslashes dans les chemins Windows ne sont PAS des échappements en argfile,
    // donc on peut les garder tels quels.
    const content = args.map(a => {
      const str = String(a);
      // Si l'argument contient un espace ou un point-virgule (classpath), le quoter
      if (str.includes(' ') || str.includes(';') || str.includes('\t')) {
        return `"${str.replace(/"/g, '\\"')}"`;
      }
      return str;
    }).join('\n');

    fs.writeFileSync(argFilePath, content, 'utf-8');

    // Nettoyer les vieux fichiers d'arg (garder les 10 plus récents)
    try {
      const files = fs.readdirSync(argDir)
        .filter(f => f.startsWith('args-'))
        .sort()
        .reverse();
      if (files.length > 10) {
        files.slice(10).forEach(f => {
          try { fs.unlinkSync(path.join(argDir, f)); } catch {}
        });
      }
    } catch {}

    return argFilePath;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LANCEMENT
  // ═══════════════════════════════════════════════════════════════

  async launch(settings = {}) {
    if (this.minecraftProcess) throw new Error('Minecraft est déjà en cours d\'exécution.');

    const {
      minRam = Config.DEFAULT_MIN_RAM, maxRam = Config.DEFAULT_MAX_RAM,
      width = Config.DEFAULT_WIDTH, height = Config.DEFAULT_HEIGHT,
      username = 'Player', uuid = '', accessToken = '',
      jvmArgs = [], gameDir = '',
      javaPath = '', fullscreen = false, disableMods = false,
    } = settings;

    this._sendProgress('Préparation du lancement...', 0);

    // 1. Métadonnées de version
    const versionMeta = await this._getVersionMeta();
    this._sendProgress('Métadonnées récupérées', 10);

    // 2. JAR Minecraft
    const mcJarPath = await this._downloadMinecraftJar(versionMeta);
    this._sendProgress('JAR Minecraft prêt', 20);

    // 3. JSON de version
    await this._downloadVersionJson(versionMeta);
    this._sendProgress('JSON de version créé', 25);

    // 4. Assets
    await this._downloadAssets(versionMeta);
    this._sendProgress('Assets vérifiés', 45);

    // 5. Librairies + natives
    const nativeExtractDir = this._getNativeExtractDir();
    await this._downloadLibraries(versionMeta, nativeExtractDir);
    this._sendProgress('Librairies prêtes', 70);

    // 6. Fabric
    const fabricProfile = await this._installFabricProfile();
    this._sendProgress('Fabric Loader prêt', 80);

    // 7. Mods (Fabric API est servi comme un mod normal par le serveur de mods)
    if (!disableMods) {
      await this._downloadMods();
    }
    this._sendProgress('Mods prêts', 90);

    // 8. Lancement
    this._sendProgress('Lancement de Minecraft...', 95);
    await this._launchProcess(
      versionMeta, nativeExtractDir, fabricProfile, mcJarPath,
      { minRam, maxRam, width, height, username, uuid, accessToken, jvmArgs, gameDir, javaPath, fullscreen }
    );
  }

  /**
   * Écrit les options par défaut du jeu (guiScale, lang, fov, vsync, etc.)
   * si le fichier options.txt n'existe pas ou si on force les valeurs par défaut.
   */
  _writeDefaultOptions(gameDir) {
    const optionsPath = path.join(gameDir, 'options.txt');
    const defaultOptions = {
      'guiScale': '2',
      'vsync': 'false',
      'fov': '80',
      'lang': 'fr_fr',
      // On garde les options existantes si le fichier existe déjà,
      // en écrasant seulement celles qu'on veut forcer.
    };

    let existing = {};
    if (fs.existsSync(optionsPath)) {
      try {
        const raw = fs.readFileSync(optionsPath, 'utf-8');
        for (const line of raw.split('\n')) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const key = line.substring(0, idx).trim();
            const val = line.substring(idx + 1).trim();
            existing[key] = val;
          }
        }
      } catch {}
    }

    // On merge : les valeurs par défaut remplacent les existantes
    const merged = { ...existing, ...defaultOptions };

    const content = Object.entries(merged)
      .map(([k, v]) => `${k}:${v}`)
      .join('\n') + '\n';

    fs.writeFileSync(optionsPath, content, 'utf-8');
    console.log(`[Options] ✓ options.txt écrit (guiScale=2, vsync=false, fov=80, lang=fr_fr) dans ${gameDir}`);
  }

  async _launchProcess(versionMeta, nativeExtractDir, fabricProfile, mcJarPath, settings) {
    const {
      minRam, maxRam, width, height, username, uuid, accessToken,
      jvmArgs, gameDir, javaPath, fullscreen,
    } = settings;

    // ─── Trouver Java ──────────────────────────────────────
    let javaBin = javaPath;
    if (!javaBin) javaBin = this._findJava();
    if (!javaBin) javaBin = await this._ensureEmbeddedJava();
    if (!javaBin) throw new Error('Java introuvable. Installez Java 21+ ou spécifiez le chemin dans les paramètres.');

    const javaVersion = this._getJavaVersion(javaBin);
    console.log(`[Launcher] Java: ${javaBin} (version ${javaVersion})`);

    const gameDirPath = gameDir || Config.MINECRAFT_DIR;
    const versionName = (fabricProfile?.versionName) || `fabric-loader-${Config.FABRIC_LOADER_VERSION}-${Config.MINECRAFT_VERSION}`;
    const mainClass = (fabricProfile?.mainClass) || 'net.fabricmc.loader.impl.launch.knot.KnotClient';

    // ─── Classpath ─────────────────────────────────────────
    const classpathEntries = new Set();

    // 1. NE PAS ajouter le version JAR Fabric (fabric-loader-0.16.13-1.20.1.jar)
    //    car depuis Fabric 0.16.10+, LoaderUtil.verifyClasspath détecte les doublons
    //    avec la library fabric-loader-0.16.13.jar dans libraries/.
    //    Les classes du loader sont dans la library, PAS dans le version JAR.
    // 2. JAR de Minecraft
    if (mcJarPath && fs.existsSync(mcJarPath)) {
      classpathEntries.add(mcJarPath);
      console.log(`[Classpath] Minecraft: ${path.basename(mcJarPath)}`);
    }

    // 3. Toutes les librairies (NE PAS exclure fabric-loader car depuis 0.15+
    //    la classe KnotClient est dans la library fabric-loader-X.Y.Z.jar, PAS dans le version JAR).
    //    Exclure seulement les intermédiaires et les natives (extraits séparément).
    const excludeFilenames = ['intermediaries'];
    if (fs.existsSync(Config.LIBRARIES_DIR)) {
      this._collectJars(Config.LIBRARIES_DIR, classpathEntries, excludeFilenames);
    }

    // 4. Natives (les .dll extraits)
    if (fs.existsSync(nativeExtractDir)) {
      classpathEntries.add(nativeExtractDir);
    }

    const rawCp = [...classpathEntries];
    // Fabric 0.18.3+ vérifie les doublons ASM → dédupliquer par artefact
    let deduplicated = this._deduplicateAsmLibraries(rawCp);
    // NE PAS laisser traîner d'anciennes versions de fabric-loader sur le classpath
    // sinon c'est la mauvaise version qui est chargée en premier par Java.
    deduplicated = this._deduplicateFabricLoader(deduplicated);
    // NE PAS laisser traîner d'anciennes versions de sponge-mixin non plus
    // (ClassCastException entre classloader 'knot' et 'app')
    deduplicated = this._deduplicateSpongeMixin(deduplicated);
    const uniqueCp = [...deduplicated].sort();
    console.log(`[Classpath] ${rawCp.length} → ${uniqueCp.length} entrées (après dédup ASM)`);
    const cpString = uniqueCp.join(';');
    const bootClasspathArgs = [];

    // ─── Arguments --add-opens pour Java 17+ ──────────────
    const addOpens = [
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang.reflect=ALL-UNNAMED',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.text=ALL-UNNAMED',
      '--add-opens', 'java.desktop/java.awt=ALL-UNNAMED',
      '--add-opens', 'java.desktop/java.awt.image=ALL-UNNAMED',
    ];

      // ─── JVM args utilisateur (filtrés) ───────────────────
    let userJvmArgs = (Array.isArray(jvmArgs) ? jvmArgs : [jvmArgs].filter(Boolean))
      .filter(a => a && a.trim())
      .map(a => a.trim());
    // Fusionner les JVM args par défaut avec ceux de l'utilisateur
    // Les args par défaut sont ajoutés en premier, puis les utilisateurs les surchargent
    // en utilisant un Set basé sur le préfixe (ex: -Dloader.xxx, -XX:+xxx)
    const mergedArgs = new Set();
    const getPrefix = (arg) => {
      const m = arg.match(/^(-[a-zA-Z]+[:=])/);
      return m ? m[1] : arg;
    };
    for (const arg of Config.DEFAULT_JVM_ARGS) mergedArgs.add(arg);
    for (const arg of userJvmArgs) {
      // Si un arg utilisateur a le même préfixe qu'un arg par défaut, il le remplace
      const prefix = getPrefix(arg);
      for (const existing of mergedArgs) {
        if (getPrefix(existing) === prefix) {
          mergedArgs.delete(existing);
        }
      }
      mergedArgs.add(arg);
    }
    userJvmArgs = [...mergedArgs];

    // ─── JVM args du profil Fabric (inclut -DFabricMcEmu avec les espaces sentinelles) ───
    const fabricJvmArgs = [];
    if (fabricProfile?.profile?.arguments?.jvm) {
      for (const arg of fabricProfile.profile.arguments.jvm) {
        if (typeof arg === 'string') {
          fabricJvmArgs.push(arg);
        }
      }
    }
    if (fabricJvmArgs.length === 0) {
      // Fallback si le profil n'a pas d'arguments JVM
      fabricJvmArgs.push('-DFabricMcEmu= net.minecraft.client.main.Main ');
    }

    // ─── Assembler TOUS les arguments ─────────────────────
    const assetsDir = path.join(Config.CACHE_DIR, 'assets');
    const assetIndex = versionMeta.assets || '1.19';
    const finalUUID = uuid || this._generateUUID();
    const finalToken = accessToken || '0';
    const userType = finalToken === '0' ? 'mojang' : 'msa';

    const allArgs = [
      `-Xms${Math.max(minRam, Config.MIN_RAM_LIMIT)}M`,
      `-Xmx${Math.min(maxRam, Config.MAX_RAM_LIMIT)}M`,
      `-Djava.library.path=${nativeExtractDir}`,
      `-Dminecraft.client.jar=${mcJarPath}`,
      ...fabricJvmArgs,    // inclut -DFabricMcEmu avec les espaces sentinelles
      ...bootClasspathArgs,
      ...addOpens,
      ...userJvmArgs,
      '-cp', cpString,
      mainClass,
      '--username', username,
      '--version', versionName,
      '--gameDir', gameDirPath,
      '--assetsDir', assetsDir,
      '--assetIndex', assetIndex,
      '--uuid', finalUUID,
      '--accessToken', finalToken,
      '--userType', userType,
      '--versionType', 'release',
      '--width', String(width),
      '--height', String(height),
    ];

    if (fullscreen) allArgs.push('--fullscreen');

    // ─── Lancement direct ──────────────────────────────────
    // Le classpath est soit court (passé directement en -cp) soit
    // un petit JAR avec manifest Class-Path (via _createClasspathJar).
    // Dans les deux cas, la ligne de commande reste sous la limite Windows.
    const totalLen = javaBin.length + allArgs.reduce((s, a) => s + a.length + 1, 0);
    console.log(`[Launcher] Ligne de commande: ${totalLen} caractères`);
    const spawnArgs = allArgs;

    // ─── Log ──────────────────────────────────────────────
    const logFile = this._getLatestLogPath();
    const logHeader = [
      `=== Minecraft Fabric Launcher ===`,
      `Date: ${new Date().toISOString()}`,
      `Java: ${javaBin} (${javaVersion})`,
      `RAM: ${Math.max(minRam, Config.MIN_RAM_LIMIT)}M - ${Math.min(maxRam, Config.MAX_RAM_LIMIT)}M`,
      `Username: ${username}`,
      `Version: ${versionName}`,
      `MainClass: ${mainClass}`,
      `Jars: ${uniqueCp.length}`,
      `Natives: ${nativeExtractDir}`,
      `Auth: ${userType}`,
      `Classpath: ${cpString.length > 100 ? 'CP-JAR (' + cpString.length + ' car)' : 'direct (' + cpString.length + ' car)'}`,
      `============================`,
      ``,
    ].join('\n');
    fs.writeFileSync(logFile, logHeader + '\n');

    console.log(`[Launcher] ========== LANCEMENT MINECRAFT ==========`);
    console.log(`[Launcher] Java: ${javaBin} (v${javaVersion})`);
    console.log(`[Launcher] RAM: ${Math.max(minRam, Config.MIN_RAM_LIMIT)}M - ${Math.min(maxRam, Config.MAX_RAM_LIMIT)}M`);
    console.log(`[Launcher] Version: ${versionName}`);
    console.log(`[Launcher] MainClass: ${mainClass}`);
    console.log(`[Launcher] Jars sur le classpath: ${uniqueCp.length}`);
    console.log(`[Launcher] Classpath: ${cpString.length > 200 ? 'CP-JAR' : 'direct'} (${cpString.length} car)`);
    console.log(`[Launcher] Logs: ${logFile}`);

      // ─── LANCEMENT ─────────────────────────────────────────
    // Utiliser java.exe (pas javaw.exe) pour avoir la console visible
    let launchJavaBin;
    if (javaBin.toLowerCase().includes('javaw.exe')) {
      const alt = javaBin.replace(/javaw\.exe$/i, 'java.exe');
      if (fs.existsSync(alt)) {
        launchJavaBin = alt;
      } else {
        // javaw.exe sans java.exe au même endroit → utiliser javaw quand même
        launchJavaBin = javaBin;
      }
    } else {
      launchJavaBin = javaBin;
    }
    console.log(`[Launcher] Binaire Java: ${launchJavaBin}`);

    this.minecraftProcess = spawn(launchJavaBin, spawnArgs, {
      cwd: Config.MINECRAFT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });

    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    this.minecraftProcess.stdout.on('data', (data) => {
      const str = data.toString();
      logStream.write(str);
      // Afficher les erreurs courantes dans la console
      if (str.includes('Exception') || str.includes('Error') || str.includes('error')) {
        console.error(`[Minecraft] ${str.trim()}`);
      }
    });

    this.minecraftProcess.stderr.on('data', (data) => {
      const str = data.toString();
      logStream.write(str);
      if (str.includes('Exception') || str.includes('Error') || str.includes('error')) {
        console.error(`[Minecraft ERR] ${str.trim()}`);
      }
    });

    this.minecraftProcess.on('close', (code) => {
      logStream.end();
      console.log(`[Launcher] Minecraft fermé (code: ${code})`);
      this._sendProgress(`Minecraft fermé (code: ${code})`, 100);
      // Nettoyage
      try { fs.rmSync(nativeExtractDir, { recursive: true }); } catch {}
          // Nettoyer l'argfile si utilisé
          if (spawnArgs.length === 1 && spawnArgs[0].startsWith('@')) {
            const argFile = spawnArgs[0].substring(1);
            try { fs.unlinkSync(argFile); } catch {}
          }
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('game-exited', { code });
      }
      this.minecraftProcess = null;
    });

    this.minecraftProcess.on('error', (err) => {
      logStream.end();
      console.error(`[Launcher] Erreur lancement: ${err.message}`);
      this._sendProgress(`Erreur: ${err.message}`, 0);
      this.minecraftProcess = null;
      throw new Error(`Impossible de lancer Minecraft: ${err.message}`);
    });

    this._sendProgress('Minecraft lancé !', 100);
  }

  _collectJars(dir, results, exclude = []) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const full = path.join(dir, item);
        try {
          if (fs.statSync(full).isDirectory()) {
            this._collectJars(full, results, exclude);
          } else if (item.endsWith('.jar')) {
            const shouldExclude = exclude.some(e => item.includes(e));
            if (!shouldExclude) {
              results.add(full);
            }
          }
        } catch {}
      }
    } catch {}
  }

  _cleanOldFabricLoaderVersions() {
    // Supprime les anciennes versions de fabric-loader du cache
    // pour éviter qu'elles soient chargées sur le classpath à la place de la version actuelle.
    const fabricLoaderDir = path.join(Config.LIBRARIES_DIR, 'net', 'fabricmc', 'fabric-loader');
    if (!fs.existsSync(fabricLoaderDir)) return;
    try {
      const dirs = fs.readdirSync(fabricLoaderDir);
      const currentVersion = Config.FABRIC_LOADER_VERSION;
      let removed = 0;
      for (const dir of dirs) {
        if (dir !== currentVersion) {
          const fullPath = path.join(fabricLoaderDir, dir);
          try { fs.rmSync(fullPath, { recursive: true }); removed++; } catch {}
        }
      }
      if (removed > 0) {
        console.log(`[Nettoyage] ${removed} ancienne(s) version(s) de fabric-loader supprimée(s) du cache`);
      }
    } catch (err) {
      console.error('[!] Erreur nettoyage fabric-loader:', err.message);
    }
  }

  _deduplicateAsmLibraries(classpathEntries) {
    // Fabric 0.18.3+ detecte les duplicate ASM classes sur le classpath
    // et lance une ExceptionInInitializerError. On ne garde que la version
    // la plus récente de chaque artefact org.ow2.asm:asm-*.
    const asmCandidates = [];
    const others = [];

    for (const entry of classpathEntries) {
      const normalized = entry.replace(/\\/g, '/');
      // Identifier les JARs ASM par leur chemin : contiennent "org/ow2/asm/"
      if (normalized.includes('/org/ow2/asm/')) {
        asmCandidates.push(entry);
      } else {
        others.push(entry);
      }
    }

    if (asmCandidates.length <= 1) {
      // Pas de doublon ASM, rien à faire
      return new Set([...classpathEntries]);
    }

    // Grouper par nom d'artefact (ex: "asm", "asm-commons", "asm-tree", etc.)
    const groups = new Map();
    for (const entry of asmCandidates) {
      const normalized = entry.replace(/\\/g, '/');
      const segments = normalized.split('/');
      // Format: .../org/ow2/asm/<artifact>/<version>/<artifact>-<version>.jar
      // Le nom de l'artefact est l'avant-avant-dernier segment
      const artifactName = segments[segments.length - 3];
      const version = segments[segments.length - 2];
      const existing = groups.get(artifactName);
      if (!existing || this._compareVersions(version, existing.version) > 0) {
        groups.set(artifactName, { path: entry, version });
      }
    }

    const deduplicated = new Set(others);
    for (const { path } of groups.values()) {
      deduplicated.add(path);
    }

    console.log(`[Dedup] ASM: ${asmCandidates.length} → ${groups.size} artefacts (${asmCandidates.length - groups.size} doublons supprimés)`);
    return deduplicated;
  }

  _compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = i < pa.length ? pa[i] : 0;
      const nb = i < pb.length ? pb[i] : 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  _deduplicateFabricLoader(classpathEntries) {
    // Garde seulement la version la PLUS RÉCENTE de fabric-loader sur le classpath.
    // Résout le problème où d'anciennes versions (ex: 0.15.11) traînent après un changement de version.
    const fabricCandidates = [];
    const others = [];

    for (const entry of classpathEntries) {
      const normalized = entry.replace(/\\/g, '/');
      if (normalized.includes('/net/fabricmc/fabric-loader/')) {
        fabricCandidates.push(entry);
      } else {
        others.push(entry);
      }
    }

    if (fabricCandidates.length <= 1) {
      return new Set([...classpathEntries]);
    }

    // Garder la version avec le numéro le plus élevé
    let best = null;
    let bestVersion = '';
    for (const entry of fabricCandidates) {
      const normalized = entry.replace(/\\/g, '/');
      const segments = normalized.split('/');
      const version = segments[segments.length - 2]; // .../<version>/fabric-loader-<version>.jar
      if (!best || this._compareVersions(version, bestVersion) > 0) {
        best = entry;
        bestVersion = version;
      }
    }

    const result = new Set(others);
    if (best) result.add(best);

    console.log(`[Dedup] Fabric Loader: ${fabricCandidates.length} → 1 (gardé ${bestVersion})`);
    return result;
  }

  _deduplicateSpongeMixin(classpathEntries) {
    // Garde seulement la version la PLUS RÉCENTE de sponge-mixin sur le classpath.
    // Résout ClassCastException entre classloader 'knot' et 'app' quand deux versions coexistent.
    const mixinCandidates = [];
    const others = [];

    for (const entry of classpathEntries) {
      const normalized = entry.replace(/\\/g, '/');
      if (normalized.includes('/net/fabricmc/sponge-mixin/')) {
        mixinCandidates.push(entry);
      } else {
        others.push(entry);
      }
    }

    if (mixinCandidates.length <= 1) {
      return new Set([...classpathEntries]);
    }

    let best = null;
    let bestVersion = '';
    for (const entry of mixinCandidates) {
      const normalized = entry.replace(/\\/g, '/');
      const segments = normalized.split('/');
      const version = segments[segments.length - 2];
      if (!best || this._compareVersions(version, bestVersion) > 0) {
        best = entry;
        bestVersion = version;
      }
    }

    const result = new Set(others);
    if (best) result.add(best);

    console.log(`[Dedup] Sponge Mixin: ${mixinCandidates.length} → 1 (gardé ${bestVersion})`);
    return result;
  }

  _findJava() {
    const candidates = [];

    // JAVA_HOME
    if (process.env.JAVA_HOME) {
      candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe'));
      candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
    }

    // Program Files — chercher récursivement dans tous les sous-dossiers
    for (const base of [process.env['ProgramFiles'] || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      if (!fs.existsSync(base)) continue;
      try {
        const items = fs.readdirSync(base);
        for (const item of items) {
          const fullPath = path.join(base, item);
          // Vérifier si ce dossier contient directement un bin/java.exe
          if (fs.existsSync(path.join(fullPath, 'bin', 'java.exe')) || fs.existsSync(path.join(fullPath, 'bin', 'javaw.exe'))) {
            const jw = path.join(fullPath, 'bin', 'javaw.exe');
            if (fs.existsSync(jw)) candidates.push(jw);
            const je = path.join(fullPath, 'bin', 'java.exe');
            if (fs.existsSync(je)) candidates.push(je);
          } else {
            // Recherche récursive pour trouver les JDK/JRE dans des sous-dossiers (ex: Eclipse Adoptium/jdk-...)
            this._findJavaRecursive(fullPath, candidates);
          }
        }
      } catch {}
    }

    // .minecraft runtime
    const appDataMinecraft = path.join(process.env.APPDATA || '', '.minecraft', 'runtime');
    if (fs.existsSync(appDataMinecraft)) {
      this._findJavaRecursive(appDataMinecraft, candidates);
    }

    // Local appdata programs
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      const programsPath = path.join(localAppData, 'Programs');
      if (fs.existsSync(programsPath)) this._findJavaRecursive(programsPath, candidates);
    }

    // PATH (mais ignorer les stubs Oracle dans Common Files)
    try {
      const result = execSync('where java.exe 2>nul || where javaw.exe 2>nul', { encoding: 'utf8', timeout: 5000 });
      for (const line of result.trim().split('\n').filter(l => l.trim())) {
        const trimmed = line.trim();
        // Ignorer les stubs Oracle (Common Files\Oracle\Java\javapath)
        if (trimmed.includes('Common Files') || trimmed.includes('javapath')) continue;
        if (fs.existsSync(trimmed)) candidates.push(trimmed);
      }
    } catch {}

    // Filtrer et trier par version
    // Fabric 0.16.13 est compatible Java 17-22. Java 23+ peut causer des problèmes avec les --add-opens.
    const MAX_JAVA_VERSION = 22;
    const valid = [];
    for (const c of candidates) {
      const ver = this._getJavaVersion(c);
      if (ver >= Config.JAVA_MINIMUM_VERSION && ver <= MAX_JAVA_VERSION) {
        valid.push({ path: c, version: ver });
      }
    }

    // Trier: d'abord par version (décroissante), puis préférer les JDK aux JRE
    if (valid.length > 0) {
      valid.sort((a, b) => {
        if (a.version === b.version) {
          const aIsJdk = a.path.toLowerCase().includes('jdk');
          const bIsJdk = b.path.toLowerCase().includes('jdk');
          if (aIsJdk && !bIsJdk) return -1;
          if (!aIsJdk && bIsJdk) return 1;
        }
        return b.version - a.version;
      });
      console.log(`[Launcher] Java trouvé: ${valid[0].path} (v${valid[0].version})`);
      return valid[0].path;
    }

    return null;
  }

  _findJavaRecursive(dir, candidates, depth = 0) {
    if (depth > 8) return; // sécurité anti-boucle infinie
    try {
      for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            // Vérifier si ce dossier a un bin/ contenant java
            const binPath = path.join(full, 'bin');
            if (fs.existsSync(path.join(binPath, 'java.exe')) || fs.existsSync(path.join(binPath, 'javaw.exe'))) {
              const jw = path.join(binPath, 'javaw.exe');
              if (fs.existsSync(jw)) candidates.push(jw);
              const je = path.join(binPath, 'java.exe');
              if (fs.existsSync(je)) candidates.push(je);
            }
            // Toujours descendre dans les dossiers, peu importe leur nom
            // (sauf les dossiers système qui ne contiennent jamais de java)
            const low = item.toLowerCase();
            if (item !== 'bin' && item !== 'lib' && item !== 'include' && item !== 'jmods' &&
                item !== 'conf' && item !== 'legal' && item !== 'src' && item !== 'src.zip' &&
                item !== 'man' && !item.startsWith('.') && !low.includes('windows') &&
                !low.includes('system32') && !low.includes('syswow64')) {
              this._findJavaRecursive(full, candidates, depth + 1);
            }
          }
        } catch {}
      }
    } catch {}
  }

  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  isRunning() { return this.minecraftProcess !== null; }

  kill() {
    if (this.minecraftProcess) {
      console.log('[Launcher] Arrêt de Minecraft...');
      try { this.minecraftProcess.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (this.minecraftProcess) {
          try { this.minecraftProcess.kill('SIGKILL'); } catch {}
        }
      }, 5000);
    }
  }
}

module.exports = MinecraftLauncher;
