@echo off
REM ==============================================================================
REM Consulta NF-e - Baixa release do GitHub e reinicia (PM2 ou servico Windows)
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
    echo        Use CORRIGIR_INSTALACAO.bat se nao tiver updater.
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

if not exist "lib\sefaz-nfe-consulta-protocolo-urls.js" (
    echo.
    echo [AVISO] Pasta lib/ ausente apos update — re-baixando ZIP ^(--force^)...
    node updater.js --force
    set RESULTADO=%ERRORLEVEL%
)

if "%USOU_SERVICO%"=="1" (
    echo [INFO] Servico Windows: use reiniciar-consulta-nfe.bat apos npm install.
)

if exist "atualizar-consulta-nfe.bat" (
    echo.
    echo [INFO] Executando atualizar-consulta-nfe.bat ^(npm + PM2 + checagem^)...
    call atualizar-consulta-nfe.bat
    exit /b %ERRORLEVEL%
)

if "%USOU_PM2%"=="1" (
    echo [INFO] Reiniciando PM2...
    call pm2 delete consulta-nfe >nul 2>&1
    call pm2 start server.js --name consulta-nfe --cwd "%cd%"
    call pm2 save >nul 2>&1
)

if "%USOU_SERVICO%"=="1" (
    echo [INFO] Iniciando servico ConsultaNFE...
    net start ConsultaNFE >nul 2>&1
)

echo.
if "%RESULTADO%"=="0" (
    echo [OK] Atualizacao aplicada.
) else if "%RESULTADO%"=="1" (
    echo [INFO] Versao remota igual a local; arquivos podem ter sido re-aplicados com --force.
) else (
    echo [ERRO] Falha no updater. Confira UPDATE_* no .env ou use CORRIGIR_INSTALACAO.bat
)
echo.
pause
