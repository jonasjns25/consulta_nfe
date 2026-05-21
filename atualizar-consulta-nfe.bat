@echo off
cd /d "%~dp0"

echo ==========================================
echo   ATUALIZAR CONSULTA-NFE
echo ==========================================
echo.
echo Este script instala as dependencias novas
echo e reinicia o servico no PM2.
echo.

echo [1/3] Instalando dependencias (npm install)...
echo ------------------------------------------
call npm install
if errorlevel 1 (
    echo.
    echo [ERRO] Falha no npm install.
    echo Verifique sua conexao com a internet e se o Node.js esta instalado.
    goto :fim
)

echo.
echo [2/3] Reiniciando servico no PM2...
echo ------------------------------------------
call pm2 restart consulta-nfe 2>&1
if errorlevel 1 (
    echo.
    echo [AVISO] PM2 nao encontrou "consulta-nfe". Tentando iniciar pela primeira vez...
    call pm2 start server.js --name consulta-nfe
    if errorlevel 1 (
        echo [ERRO] Falha ao iniciar o servico no PM2.
        goto :fim
    )
    call pm2 save
)

echo.
echo [3/3] Status do servico:
echo ------------------------------------------
call pm2 list

echo.
echo ==========================================
echo [OK] Atualizacao concluida.
echo ==========================================
echo.
echo Para ver os logs em tempo real:
echo   pm2 logs consulta-nfe
echo.

:fim
echo Pressione qualquer tecla para fechar...
pause >nul
