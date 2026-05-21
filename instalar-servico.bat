@echo off
echo ========================================
echo  Instalador do Servico Consulta NFe
echo ========================================
echo.

:: Verificar se está rodando como administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Este script precisa ser executado como Administrador!
    echo Clique com botao direito e selecione "Executar como administrador"
    pause
    exit /b 1
)

:: Definir variaveis
set SERVICE_NAME=ConsultaNFe
set SERVICE_DISPLAY=Consulta NFe - Sistema de Validacao
set NODE_PATH=C:\Program Files\nodejs\node.exe
set SCRIPT_PATH=%~dp0server.js
set WORK_DIR=%~dp0

echo Verificando Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado! Instale o Node.js primeiro.
    pause
    exit /b 1
)

:: Obter caminho real do Node.js
for /f "delims=" %%i in ('where node') do set NODE_PATH=%%i
echo Node.js encontrado em: %NODE_PATH%
echo Script: %SCRIPT_PATH%
echo.

:: Verificar se NSSM existe, senao baixar
if not exist "%~dp0nssm.exe" (
    echo NSSM nao encontrado. Baixando...
    echo.
    echo Por favor, baixe o NSSM manualmente de: https://nssm.cc/download
    echo Extraia o nssm.exe (da pasta win64) para: %~dp0
    echo E execute este script novamente.
    echo.
    start https://nssm.cc/download
    pause
    exit /b 1
)

echo Removendo servico antigo (se existir)...
"%~dp0nssm.exe" stop %SERVICE_NAME% >nul 2>&1
"%~dp0nssm.exe" remove %SERVICE_NAME% confirm >nul 2>&1

echo.
echo Instalando servico...
"%~dp0nssm.exe" install %SERVICE_NAME% "%NODE_PATH%"
"%~dp0nssm.exe" set %SERVICE_NAME% AppParameters "%SCRIPT_PATH%"
"%~dp0nssm.exe" set %SERVICE_NAME% AppDirectory "%WORK_DIR%"
"%~dp0nssm.exe" set %SERVICE_NAME% DisplayName "%SERVICE_DISPLAY%"
"%~dp0nssm.exe" set %SERVICE_NAME% Description "Sistema de consulta e validacao de NFe com comparacao SAC"
"%~dp0nssm.exe" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%~dp0nssm.exe" set %SERVICE_NAME% AppStdout "%WORK_DIR%logs\service-stdout.log"
"%~dp0nssm.exe" set %SERVICE_NAME% AppStderr "%WORK_DIR%logs\service-stderr.log"
"%~dp0nssm.exe" set %SERVICE_NAME% AppRotateFiles 1
"%~dp0nssm.exe" set %SERVICE_NAME% AppRotateBytes 1048576

:: Criar pasta de logs
if not exist "%WORK_DIR%logs" mkdir "%WORK_DIR%logs"

echo.
echo Iniciando servico...
"%~dp0nssm.exe" start %SERVICE_NAME%

echo.
echo ========================================
echo  Instalacao concluida!
echo ========================================
echo.
echo O servico "%SERVICE_DISPLAY%" foi instalado e iniciado.
echo.
echo Comandos uteis:
echo   - Ver status: nssm status %SERVICE_NAME%
echo   - Parar servico: nssm stop %SERVICE_NAME%
echo   - Iniciar servico: nssm start %SERVICE_NAME%
echo   - Remover servico: nssm remove %SERVICE_NAME%
echo.
echo Voce tambem pode gerenciar pelo Windows:
echo   - Painel de Controle ^> Ferramentas Administrativas ^> Servicos
echo   - Ou digite "services.msc" no Executar
echo.
pause
