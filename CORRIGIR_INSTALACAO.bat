@echo off
setlocal enableextensions
cd /d "%~dp0"
set "DIR_PROJETO=%cd%"
set "REPO=https://raw.githubusercontent.com/jonasjns25/consulta_nfe/main"

echo ============================================================
echo   CORRIGIR INSTALACAO - Consulta NF-e
echo   Baixa lib/ e scripts do GitHub e reinicia o PM2
echo ============================================================
echo.
echo Pasta: %DIR_PROJETO%
echo.

where curl >nul 2>&1
if errorlevel 1 (
    echo [ERRO] curl nao encontrado. Use Windows 10+ ou instale curl.
    echo Alternativa: execute atualizar_agora.bat com UPDATE_* no .env
    goto :fim
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    goto :fim
)

if not exist "lib" mkdir "lib"
if not exist "scripts" mkdir "scripts"

echo [1/4] Baixando arquivos do GitHub ^(main^)...
echo.

call :baixar "lib/sefaz-nfe-consulta-protocolo-urls.js"
if errorlevel 1 goto :falha_download
call :baixar "lib/sefaz-situacao-protocolo.js"
if errorlevel 1 goto :falha_download
call :baixar "lib/sefaz-consulta-limiter.js"
if errorlevel 1 goto :falha_download
call :baixar "scripts/verificar-modulos-obrigatorios.cjs"
if errorlevel 1 goto :falha_download
call :baixar "scripts/pm2-consulta-status.cjs"
if errorlevel 1 goto :falha_download
call :baixar "atualizar-consulta-nfe.bat"
if errorlevel 1 goto :falha_download

echo.
echo [2/4] Conferindo modulos...
call node scripts\verificar-modulos-obrigatorios.cjs
if errorlevel 1 goto :fim

echo.
echo [3/4] npm install...
call npm install
if errorlevel 1 goto :fim

echo.
echo [4/4] Reiniciando PM2...
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [AVISO] PM2 nao encontrado. Inicie manualmente: node server.js
    goto :fim
)
call pm2 delete consulta-nfe >nul 2>&1
timeout /t 1 /nobreak >nul
call pm2 start server.js --name consulta-nfe --cwd "%DIR_PROJETO%"
call pm2 save >nul 2>&1
timeout /t 4 /nobreak >nul
call pm2 list
call node scripts\pm2-consulta-status.cjs
if errorlevel 1 goto :fim

echo.
echo [OK] Correcao aplicada.
goto :fim

:baixar
set "REL=%~1"
set "DEST=%DIR_PROJETO%\%REL:\=/%"
for %%I in ("%DEST%") do mkdir "%%~dpI" 2>nul
echo   + %REL%
curl -fsSL -o "%DEST%" "%REPO%/%REL%"
if errorlevel 1 exit /b 1
exit /b 0

:falha_download
echo.
echo [ERRO] Falha ao baixar do GitHub. Verifique internet/firewall.
echo URL base: %REPO%
goto :fim

:fim
echo.
pause
exit /b 0
