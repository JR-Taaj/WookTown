@echo off
:: ════════════════════════════════════════════════════════════════════════
::  LANCEMENT DU SERVEUR DE MODS - Minecraft Fabric Launcher
::  Configure le pare-feu automatiquement, puis lance le serveur.
::  Accessible depuis votre réseau local (et Internet avec redirection).
:: ════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion

title Minecraft Launcher - Serveur de mods

:: ─── CONFIGURATION ──────────────────────────────────────────────────────
set PORT=8080

:: ─── ALLER DANS LE BON DOSSIER ─────────────────────────────────────────
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    SERVEUR DE MODS - Minecraft Launcher          ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: ─── DETECTER L'IP LOCALE ──────────────────────────────────────────────
set LOCAL_IP=
for /f "tokens=3 delims=: " %%i in ('netsh interface ip show address ^| findstr "IP Address"') do if not defined LOCAL_IP set LOCAL_IP=%%i
for /f "tokens=2 delims=: " %%i in ('ipconfig ^| find /i "IPv4"') do if not defined LOCAL_IP set LOCAL_IP=%%i
if not defined LOCAL_IP set LOCAL_IP=127.0.0.1

:: ─── DETECTER L'IP PUBLIQUE ────────────────────────────────────────────
echo [INFO] Recherche de l'IP publique...
set PUBLIC_IP=
for /f "tokens=*" %%i in ('curl -s --connect-timeout 3 ifconfig.me 2^>nul') do set PUBLIC_IP=%%i
if not defined PUBLIC_IP (
    for /f "tokens=*" %%i in ('curl -s --connect-timeout 3 api.ipify.org 2^>nul') do set PUBLIC_IP=%%i
)

echo.
echo Adresse locale  : http://%LOCAL_IP%:%PORT%
if defined PUBLIC_IP (
    echo Adresse publique : http://%PUBLIC_IP%:%PORT%
    echo.
    echo (Ne fonctionnera que si le port %PORT% est ouvert dans votre routeur)
) else (
    echo Adresse publique : [non detectee - verifiez votre connexion Internet]
)
echo.

:: ─── PARE-FEU (admin check automatique) ─────────────────────────────────
echo [INFO] Verification du pare-feu...
netsh advfirewall firewall show rule name="Minecraft Launcher - Mods Server (Port %PORT%)" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Ajout de la regle pare-feu...
    netsh advfirewall firewall add rule name="Minecraft Launcher - Mods Server (Port %PORT%)" dir=in action=allow protocol=TCP localport=%PORT% profile=any description="Minecraft Launcher - Mods Server" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [OK] Regle pare-feu ajoutee.
    ) else (
        echo [!] Impossible d'ajouter la regle pare-feu (pas admin).
        echo    Les autres machines du reseau ne pourront peut-etre pas se connecter.
        echo    Pour corriger : lancez setup-firewall-admin.bat en tant qu'administrateur.
    )
) else (
    echo [OK] Regle pare-feu deja presente.
)

:: ─── CHECK DEPENDANCES ─────────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Node.js n'est pas installe !
    pause
    exit /b 1
)

:: ─── LANCER LE SERVEUR ────────────────────────────────────────────────
echo.
echo [INFO] Demarrage du serveur...
echo.
echo ==============================================
echo   URL locale     : http://%LOCAL_IP%:%PORT%
if defined PUBLIC_IP (
echo   URL publique   : http://%PUBLIC_IP%:%PORT%
)
echo   Liste des mods : http://%LOCAL_IP%:%PORT%/mods/list
echo   Sante          : http://%LOCAL_IP%:%PORT%/health
echo.
echo   Pour BUILDER l'installateur pour vos joueurs :
echo     set LAUNCHER_SERVER_HOST=%PUBLIC_IP%
echo     npm run electron-build
echo ==============================================
echo.

:: Lancer le serveur avec EXTERNAL_URL pour que les URLs des mods
:: pointent vers l'IP publique
set "EXTERNAL_URL=http://%PUBLIC_IP%:%PORT%"
if defined PUBLIC_IP (
    echo [INFO] Les mods seront servis avec l'URL publique : %EXTERNAL_URL%
    echo.
)

node server/server.js

:: Si le serveur s'arrete (CTRL+C), on attend
echo.
echo [INFO] Serveur arrete.
pause
