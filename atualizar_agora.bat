@echo off
REM ==============================================================================
REM Consulta NF-e - Forca verificacao de atualizacao (GitHub Releases)
REM Compativel com PM2 (consulta-nfe) e servico Windows (ConsultaNFE)
REM ==============================================================================
setlocal enableextensions
cd /d "%~dp0"

echo.
echo ==================================================
echo   Consulta NF-e :: Atualizacao remota
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    pause
    exit /b 1
)

if not exist "updater.js" (
    echo [ERRO] updater.js nao encontrado em %cd%
    pause
    exit /b 1
)

set USOU_PM2=0
set USOU_SERVICO=0

where pm2 >nul 2>&1
if not errorlevel 1 (
    pm2 describe consulta-nfe >nul 2>&1
    if not errorlevel 1 (
        set USOU_PM2=1
        echo [INFO] Parando PM2 (consulta-nfe)...
        call pm2 stop consulta-nfe >nul 2>&1
        timeout /t 3 /nobreak >nul
    )
)

sc query ConsultaNFE >nul 2>&1
if not errorlevel 1 (
    set USOU_SERVICO=1
    echo [INFO] Parando servico ConsultaNFE...
    net stop ConsultaNFE >nul 2>&1
    timeout /t 3 /nobreak >nul
)

echo [INFO] Verificando atualizacoes no GitHub...
node updater.js %*
set RESULTADO=%ERRORLEVEL%

if "%USOU_PM2%"=="1" (
    echo [INFO] Reiniciando PM2...
    call pm2 start consulta-nfe >nul 2>&1
    if errorlevel 1 call pm2 restart consulta-nfe
)

if "%USOU_SERVICO%"=="1" (
    echo [INFO] Iniciando servico ConsultaNFE...
    net start ConsultaNFE >nul 2>&1
)

echo.
if "%RESULTADO%"=="0" (
    echo [OK] Atualizacao aplicada. Reinicie o processo se ainda nao reiniciou sozinho.
) else if "%RESULTADO%"=="1" (
    echo [INFO] Ja esta na versao mais recente.
) else (
    echo [ERRO] Falha na verificacao. Confira UPDATE_* no .env e a release no GitHub.
)
echo.
pause
