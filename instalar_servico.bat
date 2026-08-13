@echo off
REM ==============================================================================
REM Consulta NF-e - Instala o sistema como SERVICO do Windows usando NSSM.
REM O servico inicia junto com o Windows e reinicia automaticamente apos updates.
REM ==============================================================================
setlocal enableextensions

cd /d "%~dp0"

REM Precisa de privilegios de administrador
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERRO] Este script precisa ser executado como ADMINISTRADOR.
    echo Clique com o botao direito e escolha "Executar como administrador".
    echo.
    pause
    exit /b 1
)

set NOME_SERVICO=ConsultaNFE
set DIR_PROJETO=%cd%
set NSSM_DIR=%DIR_PROJETO%\nssm
set NSSM_EXE=%NSSM_DIR%\nssm.exe
set NSSM_URL=https://nssm.cc/release/nssm-2.24.zip
set NSSM_ZIP=%TEMP%\nssm-2.24.zip

echo.
echo ==================================================
echo   Consulta NF-e :: Instalacao do Servico Windows
echo ==================================================
echo.

REM Verifica Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado no PATH.
    echo Instale o Node.js antes de continuar: https://nodejs.org/
    pause
    exit /b 1
)

REM Verifica .env
if not exist ".env" (
    echo [ERRO] Arquivo .env nao encontrado em %DIR_PROJETO%
    echo Copie env.sample para .env e configure antes de instalar o servico.
    pause
    exit /b 1
)

REM Baixa NSSM se nao tiver
if not exist "%NSSM_EXE%" (
    echo [INFO] Baixando NSSM...
    powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NSSM_URL%' -OutFile '%NSSM_ZIP%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"
    if errorlevel 1 (
        echo [ERRO] Falha ao baixar NSSM. Verifique sua conexao com a internet.
        pause
        exit /b 1
    )
    echo [INFO] Extraindo NSSM...
    if not exist "%NSSM_DIR%" mkdir "%NSSM_DIR%"
    powershell -NoProfile -Command "Expand-Archive -Path '%NSSM_ZIP%' -DestinationPath '%TEMP%\nssm_extract' -Force"
    if exist "%TEMP%\nssm_extract\nssm-2.24\win64\nssm.exe" (
        copy /Y "%TEMP%\nssm_extract\nssm-2.24\win64\nssm.exe" "%NSSM_EXE%" >nul
    ) else if exist "%TEMP%\nssm_extract\nssm-2.24\win32\nssm.exe" (
        copy /Y "%TEMP%\nssm_extract\nssm-2.24\win32\nssm.exe" "%NSSM_EXE%" >nul
    ) else (
        echo [ERRO] Nao foi possivel localizar nssm.exe apos extracao.
        pause
        exit /b 1
    )
    rmdir /S /Q "%TEMP%\nssm_extract" >nul 2>&1
    del /Q "%NSSM_ZIP%" >nul 2>&1
)

REM Descobre caminho do node.exe
for /f "delims=" %%i in ('where node') do set NODE_EXE=%%i
echo [INFO] Node.js: %NODE_EXE%
echo [INFO] Diretorio do projeto: %DIR_PROJETO%

REM Se o servico ja existe, para e remove
sc query %NOME_SERVICO% >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Servico ja existe. Removendo versao anterior...
    "%NSSM_EXE%" stop %NOME_SERVICO% >nul 2>&1
    "%NSSM_EXE%" remove %NOME_SERVICO% confirm >nul 2>&1
    timeout /t 2 /nobreak >nul
)

REM Garante que a pasta de logs existe
if not exist "%DIR_PROJETO%\logs" mkdir "%DIR_PROJETO%\logs"

echo [INFO] Instalando servico %NOME_SERVICO%...
"%NSSM_EXE%" install %NOME_SERVICO% "%NODE_EXE%" "server.js"
"%NSSM_EXE%" set %NOME_SERVICO% AppDirectory "%DIR_PROJETO%"
"%NSSM_EXE%" set %NOME_SERVICO% DisplayName "Consulta NF-e"
"%NSSM_EXE%" set %NOME_SERVICO% Description "Sistema de Consulta de NF-e (Node.js + Express). Atualiza automaticamente via GitHub Releases."
"%NSSM_EXE%" set %NOME_SERVICO% Start SERVICE_AUTO_START
"%NSSM_EXE%" set %NOME_SERVICO% AppStdout "%DIR_PROJETO%\logs\server.log"
"%NSSM_EXE%" set %NOME_SERVICO% AppStderr "%DIR_PROJETO%\logs\server-erro.log"
"%NSSM_EXE%" set %NOME_SERVICO% AppRotateFiles 1
"%NSSM_EXE%" set %NOME_SERVICO% AppRotateBytes 10485760
"%NSSM_EXE%" set %NOME_SERVICO% AppStopMethodSkip 0
"%NSSM_EXE%" set %NOME_SERVICO% AppExit Default Restart
"%NSSM_EXE%" set %NOME_SERVICO% AppExit 75 Restart
"%NSSM_EXE%" set %NOME_SERVICO% AppRestartDelay 3000

echo [INFO] Iniciando servico...
"%NSSM_EXE%" start %NOME_SERVICO%
if errorlevel 1 (
    echo.
    echo [AVISO] Servico instalado mas nao iniciou. Verifique logs em logs\server-erro.log
    pause
    exit /b 1
)

echo.
echo ==================================================
echo   Servico %NOME_SERVICO% instalado com sucesso!
echo ==================================================
echo.
echo  Status:        sc query %NOME_SERVICO%
echo  Logs:          %DIR_PROJETO%\logs\server.log
echo  Parar:         sc stop %NOME_SERVICO%
echo  Iniciar:       sc start %NOME_SERVICO%
echo  Desinstalar:   desinstalar_servico.bat
echo.
echo  O sistema esta rodando em http://localhost:%PORT%
echo  (porta configurada em .env, padrao 3000)
echo.
pause
