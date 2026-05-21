@echo off
setlocal enabledelayedexpansion

REM ==================== Configurações iniciais =========================
cd /d "%~dp0"
set "APP_PORT=3008"
set "NODE_VERSION=20.10.0"
set "NODE_INSTALLER=node-v%NODE_VERSION%-x64.msi"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/%NODE_INSTALLER%"
set "LOG_DIR=%CD%\logs"
set "SERVER_LOG=%LOG_DIR%\server.log"
set "SETUP_STATUS=OK"

echo.
echo ==================================================
echo   Consulta NF-e :: Provisionando ambiente
echo ==================================================
echo.

REM =============== Checagem de arquivos essenciais ============

if not exist package.json (
    echo [ERRO] package.json NAO encontrado em: %CD%
    set "SETUP_STATUS=ERRO"
    goto :FIM
)
if not exist server.js (
    echo [ERRO] server.js NAO encontrado em: %CD%
    set "SETUP_STATUS=ERRO"
    goto :FIM
)
if not exist index.html (
    echo [AVISO] index.html NAO encontrado. Algumas funções web podem não funcionar!
)

REM =============== Checagem e Instalação do Node.js ===============

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Node.js nao encontrado. Instalando versao %NODE_VERSION%...
    powershell -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_INSTALLER%'"
    if exist "%NODE_INSTALLER%" (
        start /wait "" "%NODE_INSTALLER%" /quiet
        del "%NODE_INSTALLER%"
        echo [INFO] Instalei o Node.js. FECHAR TUDO E EXECUTAR DE NOVO se PATH der erro!
    ) else (
        echo [ERRO] Falha ao baixar instalador do Node.js.
        set "SETUP_STATUS=ERRO"
        goto :FIM
    )
)
node -v >nul 2>nul || (
    echo [ERRO] Node.js instalado mas nao aparece no PATH.
    echo [INFO] Feche todas janelas de comando e execute este setup novamente!
    set "SETUP_STATUS=ERRO"
    goto :FIM
)
for /f "tokens=2 delims=v" %%A in ('node -v') do set "NODE_FOUND=%%A"
echo [INFO] Node.js encontrado (v!NODE_FOUND!).

REM =============== Instala dependências do projeto ==================

echo.
echo [INFO] Instalando dependencias do projeto...
if exist package-lock.json (
    call npm ci --omit=dev
) else (
    call npm install --production
)
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias. Verifique npm e conexao.
    set "SETUP_STATUS=ERRO"
    goto :FIM
)
echo [INFO] Dependencias instaladas.

REM =============== Garante arquivo .env ============================
if not exist ".env" (
    if exist "env.sample" (
        copy /Y "env.sample" ".env" >nul
        echo [INFO] Arquivo .env criado a partir de env.sample (ajuste credenciais).
    ) else (
        echo [AVISO] .env nao encontrado. Crie um arquivo com as variaveis necessárias!
    )
)

REM =============== Cria pasta de logs =============================
if not exist "%LOG_DIR%" (
    mkdir "%LOG_DIR%"
)

REM =============== Inicializa o servidor Node =====================
echo.
echo [INFO] Iniciando servidor (porta %APP_PORT%)...
if exist "%SERVER_LOG%" del "%SERVER_LOG%" >nul 2>nul

REM Comando seguro: tudo em uma linha, sem ^ e sem echo. intermediário
start "consulta-nfe-server" cmd /k "cd /d \"%CD%\" && echo [INFO] Logs gravados em %SERVER_LOG% && node server.js >> \"%SERVER_LOG%\" 2>&1"

ping 127.0.0.1 -n 4 >nul
start "" "http://localhost:%APP_PORT%"

REM =============== Mensagem final ============================
:FIM
echo.
if /I "%SETUP_STATUS%"=="ERRO" (
    echo [ERRO] Provisionamento finalizado com erro. Revise as mensagens acima
    echo        e, se necessario, o log do servidor em %SERVER_LOG%.
) else (
    echo [INFO] Provisionamento finalizado com sucesso!
    echo Para encerrar, feche a janela "consulta-nfe-server" ou finalize o processo node.
)
echo.
pause
endlocal
