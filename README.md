# ⛏️ Minecraft Fabric Launcher - Electron

Un launcher Minecraft moderne avec support Fabric 1.20.1, téléchargement automatique des mods depuis un serveur, connexion Microsoft/crack, et interface complète de paramètres.

## ✨ Fonctionnalités

- **Lancement en un clic** - Pas de sélection d'instance
- **Fabric 1.20.1** - Chargeur de mods pré-intégré
- **Mods depuis serveur** - Téléchargement automatique avec vérification SHA256
- **Connexion Microsoft** - Authentification officielle via popup intégrée
- **Mode crack** - Jouer sans compte Microsoft (offline)
- **Paramètres complets** - RAM, résolution, arguments JVM, dossier personnalisé
- **Détection automatique de Java** - Java 21 embarqué ou détection système
- **Interface sombre glassmorphique** - Design moderne et premium
- **Installateur Windows** - .exe avec electron-builder (NSIS)

## 🚀 Pour les utilisateurs

1. **Téléchargez** l'installateur depuis votre fournisseur
2. **Installez** le launcher comme n'importe quel logiciel Windows
3. **Lancez-le** — connectez-vous avec Microsoft ou en mode crack
4. **Jouez** — les mods sont téléchargés automatiquement

> Aucune installation de Java nécessaire — le launcher embarque Java 21.

---

## 🛠️ Pour les développeurs / admins

### 📋 Prérequis

- **Node.js 18+** (pour le développement et le build)
- **npm** (inclus avec Node.js)

### 🔧 Développement local

```bash
# 1. Installer les dépendances
cd electron-launcher
npm install

# 2. Lancer le serveur de mods (dans un terminal)
npm run server
# → http://localhost:8080

# 3. Lancer le launcher en mode dev (autre terminal)
npm run electron-dev
```

### 📦 Ajouter des mods

1. Mets tes fichiers `.jar` dans `server/mods/`
2. Redémarre le serveur — la liste est générée automatiquement
3. Le launcher téléchargera les mods au prochain lancement

> Les mods sont supprimés puis re-téléchargés à chaque lancement.
> Cela garantit que tous les joueurs ont exactement les mêmes mods.

---

## 🌐 Mise en production (déploiement)

### Architecture

```
                    ┌──────────────────┐
                    │   Serveur de     │
                    │   mods (VPS)     │
                    │  :8080           │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   Launcher       │
                    │   (chez chaque   │
                    │   utilisateur)   │
                    └──────────────────┘
```

### 1. Déploiement du serveur de mods

**Option A : Simple (Node.js direct)**

```bash
# Sur votre VPS (Ubuntu/Debian exemple)
git clone <votre-repo> /opt/minecraft-launcher
cd /opt/minecraft-launcher/electron-launcher

# Installer Node.js si pas déjà fait
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Installer les dépendances
npm install --production

# Lancer le serveur
EXTERNAL_URL=https://mods.monserveur.com PORT=8080 node server/server.js
```

**Option B : Avec systemd (recommandé pour production)**

Créez `/etc/systemd/system/minecraft-mods.service` :

```ini
[Unit]
Description=Minecraft Fabric Launcher - Mods Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/minecraft-launcher/electron-launcher
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=HOST=0.0.0.0
Environment=EXTERNAL_URL=https://mods.monserveur.com

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now minecraft-mods
```

**Option C : Avec reverse proxy Nginx + HTTPS**

```nginx
server {
    listen 80;
    server_name mods.monserveur.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name mods.monserveur.com;

    ssl_certificate /etc/letsencrypt/live/mods.monserveur.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mods.monserveur.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_buffering off;
    }
}
```

### 2. Builder l'installateur du launcher

Sur votre machine de développement Windows :

**Méthode 1 : Script de déploiement**

1. Éditez `deploy-prod.bat` avec vos infos serveur
2. Lancez `deploy-prod.bat`
3. L'installateur sera dans `dist-installers/`

**Méthode 2 : Ligne de commande**

```cmd
set LAUNCHER_SERVER_HOST=mods.monserveur.com
set LAUNCHER_SERVER_PORT=8080
set LAUNCHER_SERVER_PROTOCOL=https
npm run electron-build
```

**Méthode 3 : PowerShell**

```powershell
$env:LAUNCHER_SERVER_HOST = "mods.monserveur.com"
$env:LAUNCHER_SERVER_PROTOCOL = "https"
npm run electron-build
```

### 3. Distribution

1. L'installateur généré est dans `electron-launcher/dist-installers/`
2. Distribuez le fichier `Minecraft Fabric Launcher Setup 1.0.0.exe`
3. Les utilisateurs l'installent et peuvent jouer immédiatement
4. Le launcher se connecte automatiquement à votre serveur de mods

> **Important :** Le serveur de mods est le seul point de distribution.
> Pour mettre à jour les mods, il suffit de modifier `server/mods/` sur le VPS.

---

## 🔧 Scripts disponibles

```bash
npm start              # Dev : serveur React
npm run build          # Build React uniquement
npm run electron-dev   # Dev : React + Electron
npm run electron-build # Build production + installateur
npm run server         # Lancement du serveur de mods local

# Scripts production :
deploy-prod.bat        # Build avec configuration serveur distant
```

## ⚙️ Variables d'environnement

| Variable | Rôle | Défaut |
|----------|------|--------|
| `LAUNCHER_SERVER_HOST` | Adresse du serveur de mods | `127.0.0.1` |
| `LAUNCHER_SERVER_PORT` | Port du serveur | `8080` |
| `LAUNCHER_SERVER_PROTOCOL` | Protocole (http/https) | `http` |
| `EXTERNAL_URL` | URL publique du serveur (pour les clients distants) | — |
| `HOST` | Interface d'écoute du serveur | `0.0.0.0` |
| `PORT` | Port d'écoute du serveur | `8080` |

## 📂 Structure du projet

```
electron-launcher/
├── main/                    # Processus principal Electron
│   ├── index.js            # Fenêtre, IPC, lifecycle
│   ├── preload.js          # API exposée au renderer
│   ├── config.js           # Configuration centralisée
│   ├── minecraft.js        # Logique de téléchargement et lancement
│   └── auth.js             # Authentification Microsoft/crack
├── src/                    # Interface React
│   ├── App.js              # Composant principal
│   ├── App.css             # Styles glassmorphiques
│   └── index.js            # Point d'entrée
├── public/                 # Fichiers statiques
│   └── index.html
├── server/                 # Serveur de mods HTTP
│   ├── server.js           # Serveur avec endpoint /mods/list, /mods/files
│   ├── mods/               # Dossier contenant les .jar
│   └── mods.json           # Généré automatiquement
├── assets/                 # Images, icônes
│   ├── icon.png
│   ├── icon.ico
│   └── wallpaper.jpg
├── build/                  # Build React (généré)
├── dist-installers/        # Installateur Windows (généré)
├── deploy-prod.bat         # Script de build production
└── package.json
```

## 🔧 Dépannage

**Le launcher ne trouve pas le serveur de mods ?**
- Vérifiez que le serveur tourne : `curl http://votre-serveur.com:8080/health`
- Vérifiez le pare-feu (port 8080 ouvert)
- Vérifiez que `LAUNCHER_SERVER_HOST` est correct dans le build

**Erreur de connexion Microsoft ?**
- Le launcher utilise un flux OAuth avec device code
- Une popup s'ouvre avec un code à valider sur microsoft.com/link
- Si la popup ne s'ouvre pas, vérifiez les popups bloquées

**Minecraft ne se lance pas ?**
- Consultez les logs dans `%APPDATA%/MinecraftLauncher/minecraft/logs/`
- Vérifiez que Java 21+ est installé ou activé
- Réduisez la RAM allouée (2048 Mo minimum)

**Erreur "EADDRINUSE" au lancement ?**
- Un autre processus utilise déjà le port 8080
- Changez le port via la variable `PORT`

## 📄 Licence

MIT — Faites ce que vous voulez du code.
Minecraft est une marque déposée de Mojang AB.
Ce launcher n'est pas affilié à Mojang ou Microsoft.
