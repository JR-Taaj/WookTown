@echo off
:: ════════════════════════════════════════════════════════════════════════
::  PUBLIER UNE NOUVELLE VERSION SUR GITHUB
::  Usage : release.bat 1.1.0 "Description de la mise a jour"
:: ════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion

echo ╔══════════════════════════════════════════════════╗
echo ║    PUBLIER UNE MISE A JOUR - WookTown Launcher  ║
echo ╚══════════════════════════════════════════════════╝
echo.

REM ─── Vérifier le token GitHub ─────────────────────────────────────
if "%GH_TOKEN%"=="" (
    echo [ATTENTION] Variable GH_TOKEN non definie.
    echo.
    echo Cree un Personal Access Token sur GitHub :
    echo   1. Va sur https://github.com/settings/tokens
    echo   2. Genere un token avec scope "repo"
    echo   3. Copie le token
    echo.
    echo Ensuite tu peux soit :
    echo   - Definir la variable : set GH_TOKEN=ghp_xxxxxxxxxxxx
    echo   - Ou lancer : set /p GH_TOKEN=Colle ton token GitHub :
    set /p GH_TOKEN=Token GitHub :
)

REM ─── Version (optionnel) ──────────────────────────────────────────
set NEW_VERSION=%1
if "%NEW_VERSION%"=="" set NEW_VERSION=1.1.0

set RELEASE_NOTES=%2
if "%RELEASE_NOTES%"=="" set RELEASE_NOTES=Nouvelle version %NEW_VERSION%

REM ─── Mettre a jour la version dans package.json ──────────────────
echo [1/5] Mise a jour de la version vers %NEW_VERSION%...
cd /d "%~dp0"
powershell -Command "(Get-Content package.json) -replace '\"version\": \"[^\"]+\"', '\"version\": \"%NEW_VERSION%\"' | Set-Content package.json"

REM ─── Build l'installateur ────────────────────────────────────────
echo [2/5] Build de l'installateur...
set LAUNCHER_SERVER_HOST=90.35.92.246
set LAUNCHER_SERVER_PORT=8080
set LAUNCHER_SERVER_PROTOCOL=http

call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Build React echoue.
    exit /b 1
)

call npx electron-builder --win --x64
if %ERRORLEVEL% neq 0 (
    echo [ERREUR] Build Electron echoue.
    exit /b 1
)

echo [3/5] Build termine avec succes.

REM ─── Commit et push vers GitHub ──────────────────────────────────
echo [4/5] Commit et push vers GitHub...
git add -A
git commit -m "Version %NEW_VERSION%"
git push origin main 2>nul || git push origin master 2>nul

REM ─── Creer la release GitHub avec l'installateur ─────────────────
echo [5/5] Creation de la release GitHub...

:: Chercher l'installateur
set INSTALLER=
for /r "dist-electron-new" %%f in (*.exe) do set INSTALLER=%%f
for /r "dist" %%f in (*.exe) do if not defined INSTALLER set INSTALLER=%%f
for /r "dist-installers" %%f in (*.exe) do if not defined INSTALLER set INSTALLER=%%f
for /r "dist-electron-new" %%f in (*.exe.blockmap) do set BLOCKMAP=%%f
for /r "dist-electron-new" %%f in (*.yml) do set YML=%%f

echo Installateur trouve : %INSTALLER%
echo.

:: Creer la release via GitHub CLI si disponible
where gh >nul 2>&1
if !ERRORLEVEL! equ 0 (
    gh release create "v%NEW_VERSION%" "%INSTALLER%" "%BLOCKMAP%" "%YML%" --title "v%NEW_VERSION%" --notes "%RELEASE_NOTES%"
    if !ERRORLEVEL! equ 0 (
        echo [OK] Release creee sur GitHub !
    ) else (
        echo [!] GitHub CLI echoue. Fais-le manuellement :
    )
) else (
    echo [!] GitHub CLI (gh) non installe.
    echo.
    echo Upload les fichiers suivants sur GitHub Releases manuellement :
    echo   - %INSTALLER%
    echo   - %BLOCKMAP%
    echo   - %YML%
    echo.
    echo Va sur : https://github.com/JR-Taaj/WookTown/releases/new
    echo Tag : v%NEW_VERSION%
    echo.
)

echo.
echo ==============================================
echo  Termine !
echo  Les joueurs recevront la maj v%NEW_VERSION%
echo  au prochain demarrage du launcher.
echo ==============================================
echo.
pause
