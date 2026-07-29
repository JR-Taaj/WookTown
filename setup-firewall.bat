@echo off
:: ════════════════════════════════════════════════════════════════════════
::  CONFIGURATION PARE-FEU WINDOWS - Minecraft Fabric Launcher
::  Ouvre le port 8080 pour que le serveur de mods soit accessible
::  depuis n'importe où (y compris depuis Internet si le routeur forwarde)
:: ════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion

:: ─── CONFIGURATION ──────────────────────────────────────────────────────
:: Port du serveur de mods
set PORT=8080

:: Nom de la règle dans le pare-feu
set RULE_NAME=Minecraft Launcher - Serveur de mods (Port %PORT%)

:: ─── ADMIN RIGHTS CHECK ────────────────────────────────────────────────
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [!!!] Ce script doit etre lance en tant qu'ADMINISTRATEUR.
    echo.
    echo Faites un clic droit sur ce fichier -^> "Executer en tant qu'administrateur"
    echo.
    pause
    exit /b 1
)

:: ─── AJOUTER LA REGLE ──────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    Configuration du Pare-feu Windows             ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo Port    : %PORT%
echo Regle   : %RULE_NAME%
echo.
echo [INFO] Suppression des regles existantes...
netsh advfirewall firewall delete rule name="%RULE_NAME%" >nul 2>&1

echo [INFO] Ajout de la regle (Profils : Domaine, Prive, Public)...
netsh advfirewall firewall add rule name="%RULE_NAME%" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=%PORT% ^
    profile=any ^
    description="Permet au lanceur Minecraft de telecharger les mods depuis le serveur"

if %ERRORLEVEL% equ 0 (
    echo [OK] Regle ajoutee avec succes !
) else (
    echo [ERREUR] Impossible d'ajouter la regle.
    pause
    exit /b 1
)

:: ─── VERIFIER LA REGLE ─────────────────────────────────────────────────
echo.
echo [INFO] Verification de la regle...
netsh advfirewall firewall show rule name="%RULE_NAME%" | findstr /R "Rule Name:|Enabled:|Action:|Direction:|Protocol:|LocalPort:|Profiles:"
echo.

:: ─── AFFICHER L'IP PUBLIQUE ────────────────────────────────────────────
echo Votre IP publique est :
for /f "tokens=*" %%i in ('curl -s ifconfig.me') do set PUBLIC_IP=%%i
if defined PUBLIC_IP (
    echo   %PUBLIC_IP%
    echo.
    echo Les autres joueurs peuvent se connecter avec :
    echo   http://%PUBLIC_IP%:%PORT%
    echo   http://%PUBLIC_IP%:%PORT%/health
    echo   http://%PUBLIC_IP%:%PORT%/mods/list
) else (
    echo   [Impossible de determiner l'IP publique]
)
echo.
echo IMPORTANT :
echo   Si vous etes derriere un routeur, vous devez aussi :
echo   1. Ouvrir le port %PORT% en TCP dans les parametres de votre routeur
echo   2. Rediriger le port %PORT% vers %PORT% sur 192.168.1.10
echo      (ou votre IP locale)
echo   3. Pour trouver les parametres du routeur :
echo      - Allez sur http://192.168.1.1 ou http://192.168.0.1
echo      - Cherchez "Port Forwarding", "NAT", "Redirection de ports"
echo      - Ajoutez une regle : port externe %PORT% -^> 192.168.1.10 port %PORT% (TCP)
echo.
pause
