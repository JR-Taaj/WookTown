#!/usr/bin/env node
/**
 * Serveur de mods Minecraft pour le Launcher.
 * Sert les fichiers .jar et la liste des mods via HTTP.
 * 
 * Usage: node server/server.js [--port 8080] [--host 127.0.0.1]
 * 
 * Pour la production, changez SERVER_HOST dans main/config.js
 * et déployez ce serveur sur un vrai serveur (VPS, etc.)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_DIR = __dirname;
const MODS_DIR = path.join(SERVER_DIR, 'mods');
const MODS_JSON = path.join(SERVER_DIR, 'mods.json');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT, 10) || 8080;
const PRODUCTION = process.env.NODE_ENV === 'production' || process.env.PRODUCTION === 'true';
const EXTERNAL_URL = process.env.EXTERNAL_URL || ''; // Ex: https://mods.monserveur.com

// Création du dossier mods
fs.mkdirSync(MODS_DIR, { recursive: true });

  // Construit l'URL de base pour les téléchargements
function getBaseUrl(req) {
  if (EXTERNAL_URL) return EXTERNAL_URL.replace(/\/+$/, '');
  // Derrière un reverse proxy (Nginx, Caddy, etc.)
  const proto = req?.headers?.['x-forwarded-proto'] || 'http';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || `${HOST}:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

// Fonction qui scanne le dossier mods/ et génère la liste avec SHA256
function scanModsFolder(baseUrl) {
  const mods = [];
  if (!fs.existsSync(MODS_DIR)) return mods;
  const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')).sort();
  for (const file of files) {
    const filePath = path.join(MODS_DIR, file);
    const stat = fs.statSync(filePath);
    let sha256 = '';
    try {
      const data = fs.readFileSync(filePath);
      sha256 = crypto.createHash('sha256').update(data).digest('hex');
    } catch {}
    mods.push({
      id: path.basename(file, '.jar').replace(/[^a-zA-Z0-9_-]/g, '_'),
      name: path.basename(file, '.jar'),
      version: '1.0.0',
      filename: file,
      mc_version: '1.20.1',
      description: `Mod: ${file}`,
      url: `${baseUrl}/mods/files/${file}`,
      required: false,
      sha256,
    });
  }
  return mods;
}

// Écrire la liste scannée dans mods.json pour que le launcher la récupère
function writeModsList(baseUrl) {
  const mods = scanModsFolder(baseUrl);
  fs.writeFileSync(MODS_JSON, JSON.stringify(mods, null, 2));
  return mods;
}

// Au démarrage, écrire la liste
const startBaseUrl = EXTERNAL_URL || `http://localhost:${PORT}`;
const initialMods = writeModsList(startBaseUrl);
console.log(`[✓] Scanné ${initialMods.length} mod(s) dans ${MODS_DIR}`);

// MIME types
const MIME_TYPES = {
  '.jar': 'application/java-archive',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Liste des mods — scanne le dossier à la volée
    if (pathname === '/mods/list') {
      const baseUrl = getBaseUrl(req);
      const mods = scanModsFolder(baseUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mods));
      return;
    }

    // Checksums SHA-256
    if (pathname === '/mods/checksums') {
      const checksums = {};
      if (fs.existsSync(MODS_DIR)) {
        const files = fs.readdirSync(MODS_DIR);
        for (const file of files) {
          if (file.endsWith('.jar')) {
            const filePath = path.join(MODS_DIR, file);
            const data = fs.readFileSync(filePath);
            checksums[file] = crypto.createHash('sha256').update(data).digest('hex');
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checksums));
      return;
    }

    // Téléchargement de fichier
    if (pathname.startsWith('/mods/files/')) {
      const filename = pathname.slice('/mods/files/'.length);
      // Sécurité: éviter les path traversals
      const safeFilename = path.basename(filename);
      const filePath = path.join(MODS_DIR, safeFilename);

      if (fs.existsSync(filePath) && filePath.startsWith(MODS_DIR)) {
        const ext = path.extname(safeFilename).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const stat = fs.statSync(filePath);

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'Content-Length': stat.size,
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Fichier introuvable' }));
        return;
      }
    }

    // Upload de mods (POST)
    if (pathname === '/mods/upload' && req.method === 'POST') {
      let body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        try {
          // Recevoir un JSON avec une URL de téléchargement
          const data = JSON.parse(Buffer.concat(body).toString());
          // Pour l'instant, simple placeholder
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Upload API - à implémenter avec un vrai serveur' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Requête invalide' }));
        }
      });
      return;
    }

    // Santé du serveur
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        modsCount: fs.existsSync(MODS_DIR) ? fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')).length : 0,
      }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (err) {
    console.error('[!] Erreur serveur:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Erreur interne du serveur' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║        Serveur de Mods Minecraft Launcher       ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Adresse : http://${HOST}:${PORT}                  `);
  console.log(`║  Liste   : http://${HOST}:${PORT}/mods/list        `);
  console.log(`║  Fichiers: http://${HOST}:${PORT}/mods/files/      `);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Pour la production :                            ║');
  console.log('║  1. Déployez server/ sur un VPS                  ║');
  console.log('║  2. Modifiez SERVER_HOST dans main/config.js     ║');
  console.log('║  3. Mettez vos mods .jar dans server/mods/       ║');
  console.log('║  4. Modifiez server/mods.json                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
