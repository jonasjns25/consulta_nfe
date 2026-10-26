@echo off
setlocal enableextensions
cd /d "%~dp0"
set "DIR_PROJETO=%cd%"
set "FALHOU=0"

echo ==========================================
echo   ATUALIZAR CONSULTA-NFE  (script v2 — 5 passos)
echo ==========================================
echo.
echo Se aparecer [1/3] voce esta com script ANTIGO.
echo Baixe CORRIGIR_INSTALACAO.bat do GitHub e execute uma vez.
echo.
echo Pasta: %DIR_PROJETO%
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado no PATH.
    set "FALHOU=1"
    goto :fim
)

echo [1/5] Verificando arquivos da aplicacao...
echo ------------------------------------------
call node scripts\verificar-modulos-obrigatorios.cjs
if errorlevel 1 (
    if exist updater.js if exist .env (
        echo.
        echo [INFO] Tentando baixar release completa do GitHub ^(updater --force^)...
        call node updater.js --force
        echo.
    ) else (
        echo.
        echo [AVISO] Configure UPDATE_REPO_* no .env e use atualizar_agora.bat,
        echo         ou copie manualmente a pasta lib\ do GitHub.
        echo.
    )
    call node scripts\verificar-modulos-obrigatorios.cjs
)
if errorlevel 1 (
    set "FALHOU=1"
    goto :fim
)

echo.
echo [2/5] Instalando dependencias ^(npm install^)...
echo ------------------------------------------
call npm install
if errorlevel 1 (
    echo.
    echo [ERRO] Falha no npm install.
    set "FALHOU=1"
    goto :fim
)

echo.
echo [3/5] Reiniciando servico no PM2...
echo ------------------------------------------
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [ERRO] PM2 nao encontrado. Instale: npm install -g pm2
    set "FALHOU=1"
    goto :fim
)

call pm2 delete consulta-nfe >nul 2>&1
timeout /t 1 /nobreak >nul
call pm2 start server.js --name consulta-nfe --cwd "%DIR_PROJETO%"
if errorlevel 1 (
    echo [ERRO] Falha ao iniciar consulta-nfe no PM2.
    set "FALHOU=1"
    goto :fim
)
call pm2 save >nul 2>&1

echo.
echo [4/5] Aguardando subida do Node...
echo ------------------------------------------
timeout /t 4 /nobreak >nul

echo.
echo [5/5] Conferindo status...
echo ------------------------------------------
call pm2 list
echo.
call node scripts\pm2-consulta-status.cjs
if errorlevel 1 set "FALHOU=1"

echo.
if "%FALHOU%"=="0" (
    echo ==========================================
    echo [OK] Atualizacao concluida — servico online.
    echo ==========================================
) else (
    echo ==========================================
    echo [FALHA] Servico nao ficou online.
    echo ==========================================
    echo.
    echo Causas comuns:
    echo  - Pasta lib/ ausente ^(use atualizar_agora.bat^)
    echo  - Erro no .env ou conexao MySQL
    echo  - Porta em uso
    echo.
    echo Ver logs: pm2 logs consulta-nfe
)

:fim
echo.
if "%FALHOU%"=="1" (
    echo Pressione qualquer tecla para fechar...
    pause >nul
    exit /b 1
)
echo Para ver os logs em tempo real:
echo   pm2 logs consulta-nfe
echo.
echo Pressione qualquer tecla para fechar...
pause >nul
exit /b 0
