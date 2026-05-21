@echo off
REM Script para iniciar o servidor Node.js na pasta correta
cd /d "%~dp0"
echo ========================================
echo   Iniciando Servidor NF-e
echo ========================================
echo.
echo Verificando se Node.js esta instalado...
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Node.js nao encontrado!
    echo Instale o Node.js de https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js encontrado!
echo.
echo Verificando dependencias...
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERRO ao instalar dependencias!
        pause
        exit /b 1
    )
)

echo.
echo Iniciando servidor na porta 9000...
echo Pressione Ctrl+C para parar o servidor
echo.
node server.js
