@echo off
:: ════════════════════════════════════════════════════════════════════════
::  DEPLOIEMENT PRODUCTION - WookTown Launcher
::  Genere un installateur .exe + le publie sur GitHub Releases
:: ════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion

:: ─── CONFIGURATION ──────────────────────────────────────────────────────
set SERVER_HOST=90.35.92.246
set SERVER_PORT=8080
set SERVER_PROTOCOL=http

:: ─── NE RIEN MODIFIER CI-DESSOUS ───────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    DEPLOIEMENT PRODUCTION - WookTown Launcher    ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo Serveur de mods : %SERVER_PROTOCOL%://%SERVER_HOST%:%SERVER_PORT%
echo.
echo Les utilisateurs installeront le launcher et il se
echo connectera automatiquement a ce serveur de mods.
echo.
echo Les mises a jour se feront automatiquement via GitHub.
echo.

:: Verifier Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Node.js n'est pas installe. Installez Node.js 18+.
    exit /b 1
)

:: Installer les dependances si besoin
if not exist "node_modules\" (
    echo [INFO] Installation des dependances npm...
    call npm install
    if !ERRORLEVEL! neq 0 (
        echo [ERREUR] Echec de l'installation des dependances.
        exit /b 1
    )
)

:: Definir les variables d'environnement pour le build
set "LAUNCHER_SERVER_HOST=%SERVER_HOST%"
set "LAUNCHER_SERVER_PORT=%SERVER_PORT%"
set "LAUNCHER_SERVER_PROTOCOL=%SERVER_PROTOCOL%"

:: Nettoyer
echo [INFO] Nettoyage des builds precedents...
if exist "build\" rmdir /s /q build 2>nul
if exist "dist-installers\" rmdir /s /q dist-installers 2>nul

:: Build React
echo [INFO] Build React...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Echec du build React.
    exit /b 1
)

:: Build Electron
echo [INFO] Generation de l'installateur Windows...
call npx electron-builder --win --x64
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Echec du build Electron.
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    BUILD TERMINE AVEC SUCCES !                   ║
echo ╚══════════════════════════════════════════════════╝
echo.
:: Trouver l'installateur genere
if exist "dist-electron-new" (
    for /r "dist-electron-new" %%f in (*.exe) do (
        echo Installateur : %%f
    )
) else if exist "dist-installers" (
    for /r "dist-installers" %%f in (*.exe) do (
        echo Installateur : %%f
    )
) else (
    for /r "dist" %%f in (*.exe) do (
        echo Installateur : %%f
    )
)
echo.
echo Distribuez ce fichier a vos joueurs !
echo Le launcher contient deja votre adresse : %SERVER_PROTOCOL%://%SERVER_HOST%:%SERVER_PORT%
echo.
echo Pour que le serveur de mods fonctionne :
echo   1. Lancez start-server.bat (en tant qu'admin la 1ere fois)
echo   2. Le pare-feu sera configure automatiquement
echo   3. Si vous etes derriere un routeur, ouvrez le port %SERVER_PORT%
echo      et redirigez-le vers votre PC
echo.
pause
