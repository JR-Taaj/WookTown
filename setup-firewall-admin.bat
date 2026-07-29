@echo off
:: ════════════════════════════════════════════════════════════════════════
::  CONFIGURATION PARE-FEU - Minecraft Launcher (Admin)
::  ⚠️  Lancez ce fichier en tant qu'ADMINISTRATEUR
::     (clic droit → "Exécuter en tant qu'administrateur")
:: ════════════════════════════════════════════════════════════════════════
:: Si vous ne faites pas clic droit, ce script se relance automatiquement
:: avec les droits administrateur via PowerShell.
:: ════════════════════════════════════════════════════════════════════════

@setlocal enabledelayedexpansion

:: ─── AUTO-ELEVATION CHECK ─────────────────────────────────────────────
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Demande des droits administrateur...
    :: Se relancer en admin via PowerShell
    powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList '/c \"\"%~f0\"\"' -WindowStyle Normal"
    exit /b 0
)

title Minecraft Launcher - Configuration Pare-feu

:: ─── CONFIGURATION ──────────────────────────────────────────────────────
set PORT=8080
set RULE_NAME=Minecraft Launcher - Serveur de mods (Port %PORT%)

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    Configuration du Pare-feu Windows             ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo Port    : %PORT%
echo Regle   : %RULE_NAME%
echo.

:: Supprimer les anciennes regles
echo [INFO] Suppression des regles existantes...
netsh advfirewall firewall delete rule name="%RULE_NAME%" >nul 2>&1

:: Ajouter la nouvelle regle
echo [INFO] Ajout de la regle...
netsh advfirewall firewall add rule name="%RULE_NAME%" dir=in action=allow protocol=TCP localport=%PORT% profile=any description="Permet au serveur de mods Minecraft d'etre accessible depuis n'importe quelle machine du reseau ou Internet"

if %ERRORLEVEL% equ 0 (
    echo [OK] Regle ajoutee avec succes !
) else (
    echo [ERREUR] Impossible d'ajouter la regle.
    pause
    exit /b 1
)

:: Verification
echo.
echo [INFO] Verification...
echo.
netsh advfirewall firewall show rule name="%RULE_NAME%" | findstr /R "Rule Name:|Enabled:|Action:|Direction:|Profiles:"
echo.

:: Detecter IP locale
set LOCAL_IP=
for /f "tokens=3 delims=: " %%i in ('netsh interface ip show address ^| findstr "IP Address"') do if not defined LOCAL_IP set LOCAL_IP=%%i
for /f "tokens=2 delims=: " %%i in ('ipconfig ^| find /i "IPv4"') do if not defined LOCAL_IP set LOCAL_IP=%%i
if not defined LOCAL_IP set LOCAL_IP=127.0.0.1

:: IP publique
echo.
echo Votre IP locale    : %LOCAL_IP%
echo Votre IP publique  :
for /f "tokens=*" %%i in ('curl -s --connect-timeout 3 ifconfig.me 2^>nul') do set PUBLIC_IP=%%i
if defined PUBLIC_IP (
    echo   http://%PUBLIC_IP%:%PORT%
    echo.
    echo Vos joueurs peuvent desormais se connecter ICI (apres redirection routeur) :
    echo   - http://%PUBLIC_IP%:%PORT%/health
    echo   - http://%PUBLIC_IP%:%PORT%/mods/list
    echo   - http://%PUBLIC_IP%:%PORT%/mods/files/NOM_DU_MOD.jar
)
echo.
echo ATTENTION - Si vous etes derriere un routeur :
echo   Vous devez aussi ouvrir le port %PORT% dans les parametres de votre routeur
echo   et le rediriger vers %LOCAL_IP% :
echo.
echo   1. Allez sur http://192.168.1.1 ou http://192.168.0.1
echo   2. Cherchez "Port Forwarding", "NAT", "Redirection de ports"
echo   3. Ajoutez : Port externe %PORT% -^> %LOCAL_IP% Port %PORT% (TCP)
echo.
echo Si tout le monde est sur le meme reseau local :
echo   Utilisez l'IP locale dans le launcher : http://%LOCAL_IP%:%PORT%
echo.
echo Pour builder l'installateur pour vos joueurs :
echo   set LAUNCHER_SERVER_HOST=%PUBLIC_IP%
echo   npm run electron-build
echo.
pause
