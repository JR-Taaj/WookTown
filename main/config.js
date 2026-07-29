const path = require('path');

let app = null;
try { app = require('electron').app; } catch {}

// ─── Variables d'environnement pour la production ─────────────
// Surchargeable via process.env pour le build :
//   set LAUNCHER_SERVER_HOST=mods.monserveur.com && npm run electron-build
// Ou dans package.json "build.win.extraResources" + read depuis un fichier
const ENV = typeof process !== 'undefined' ? process.env : {};

// Configuration centralisée
const Config = {
  // ─── Auth Microsoft ─────────────────────────────────────────────
  // prismarine-auth gère l'auth avec un client_id pré-approuvé
  // Plus besoin de config Azure AD ici
  MICROSOFT_CLIENT_ID: '',
  MICROSOFT_TENANT: 'consumers',
  MICROSOFT_SCOPE: 'XboxLive.signin offline_access',
  MICROSOFT_REDIRECT_URI: '',

  // ─── Serveur de mods ─────────────────────────────────────────────
  // En dev : http://127.0.0.1:8080
  // En prod : définir LAUNCHER_SERVER_HOST (ex: mods.monserveur.com)
  //           et optionnellement LAUNCHER_SERVER_PORT, LAUNCHER_SERVER_PROTOCOL
  SERVER_HOST: ENV.LAUNCHER_SERVER_HOST || '90.35.92.246',
  SERVER_PORT: parseInt(ENV.LAUNCHER_SERVER_PORT, 10) || 8080,
  SERVER_PROTOCOL: ENV.LAUNCHER_SERVER_PROTOCOL || 'http',
  get SERVER_URL() {
    return `${this.SERVER_PROTOCOL}://${this.SERVER_HOST}:${this.SERVER_PORT}`;
  },
  get MODS_LIST_URL() {
    return `${this.SERVER_URL}/mods/list`;
  },
  get MODS_DOWNLOAD_URL() {
    return `${this.SERVER_URL}/mods/files`;
  },
  get MODS_CHECKSUMS_URL() {
    return `${this.SERVER_URL}/mods/checksums`;
  },

  // ─── Dossiers (lazy - app doit être initialisé) ────────────────
  get LAUNCHER_DIR() {
    try {
      if (app && app.isReady()) return path.join(app.getPath('userData'), 'MinecraftLauncher');
    } catch {}
    return path.join(process.env.APPDATA || process.cwd(), 'MinecraftLauncher');
  },
  get MINECRAFT_DIR() { return path.join(this.LAUNCHER_DIR, 'minecraft'); },
  get VERSIONS_DIR() { return path.join(this.MINECRAFT_DIR, 'versions'); },
  get MODS_DIR() { return path.join(this.MINECRAFT_DIR, 'mods'); },
  get ASSETS_DIR() { return path.join(this.MINECRAFT_DIR, 'assets'); },
  get LIBRARIES_DIR() { return path.join(this.MINECRAFT_DIR, 'libraries'); },
  get NATIVES_DIR() { return path.join(this.MINECRAFT_DIR, 'natives'); },
  get LOGS_DIR() { return path.join(this.MINECRAFT_DIR, 'logs'); },
  get CACHE_DIR() { return path.join(this.LAUNCHER_DIR, 'cache'); },
  get RUNTIME_DIR() { return path.join(this.LAUNCHER_DIR, 'runtime'); },

  // ─── Versions ────────────────────────────────────────────────────
  MINECRAFT_VERSION: '1.20.1',
  // Fabric 0.19.3 — compatible avec Fabric API 0.92.11+ pour 1.20.1
  FABRIC_LOADER_VERSION: '0.19.3',

  // ─── URLs Fabric ─────────────────────────────────────────────────
  FABRIC_MAVEN: 'https://maven.fabricmc.net',
  get FABRIC_LOADER_URL() {
    return `${this.FABRIC_MAVEN}/net/fabricmc/fabric-loader/${this.FABRIC_LOADER_VERSION}/fabric-loader-${this.FABRIC_LOADER_VERSION}.jar`;
  },

  // ─── URLs Minecraft ──────────────────────────────────────────────
  MINECRAFT_MANIFEST: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  MINECRAFT_RESOURCES: 'https://resources.download.minecraft.net',
  MINECRAFT_LIBRARIES: 'https://libraries.minecraft.net',

  // ─── Java ────────────────────────────────────────────────────────
  JAVA_MINIMUM_VERSION: 21,

  // ─── Téléchargement automatique Java (Temurin 21 JRE) ────────────
  BUNDLED_JRE_VERSION: '21.0.11+10',
  get BUNDLED_JRE_DIR() { return path.join(this.RUNTIME_DIR, `jdk-${this.BUNDLED_JRE_VERSION}-jre`); },
  get BUNDLED_JAVA_PATH() { return path.join(this.BUNDLED_JRE_DIR, 'bin', 'javaw.exe'); },
  get JAVA_DOWNLOAD_URL() {
    return 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip';
  },
  JAVA_DOWNLOAD_SHA256: 'be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4',
  JAVA_DOWNLOAD_SIZE: 49005708,

  // ─── Mémoire ─────────────────────────────────────────────────────
  DEFAULT_MIN_RAM: 2048,
  DEFAULT_MAX_RAM: 4096,
  MIN_RAM_LIMIT: 512,
  MAX_RAM_LIMIT: 32768,

  // ─── Résolution ──────────────────────────────────────────────────
  DEFAULT_WIDTH: 1280,
  DEFAULT_HEIGHT: 720,
  MIN_WIDTH: 800,
  MIN_HEIGHT: 480,

  // ─── JVM par défaut ──────────────────────────────────────────────
  // Fabric 0.19.3 compatible avec Java 21
  DEFAULT_JVM_ARGS: [
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:MaxGCPauseMillis=50',
    '-XX:G1HeapRegionSize=32M',
    '-Dfml.ignoreInvalidMinecraftCertificates=true',
    '-Dfml.ignorePatchDiscrepancies=true',
  ],
};

module.exports = Config;
