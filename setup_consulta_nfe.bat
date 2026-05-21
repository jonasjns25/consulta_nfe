@echo off
setlocal

REM ==============================================================================
REM Consulta NF-e - Setup Simplificado
REM Script simples e robusto para instalação
REM ==============================================================================

cd /d "%~dp0"
set "APP_ROOT=%CD%"

echo.
echo ==================================================
echo   Consulta NF-e :: Instalacao
echo ==================================================
echo.

REM Verificar Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado!
    echo.
    echo Por favor, instale o Node.js manualmente:
    echo 1. Acesse: https://nodejs.org/
    echo 2. Baixe e instale a versao LTS
    echo 3. Execute este script novamente
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js encontrado
node -v

REM Verificar package.json
if not exist "%APP_ROOT%\package.json" (
    echo [ERRO] package.json nao encontrado!
    echo.
    pause
    exit /b 1
)

echo [OK] package.json encontrado
echo.

REM Instalar dependencias
echo [INFO] Instalando dependencias...
echo.
call npm install
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Dependencias instaladas
echo.

REM Criar arquivo .env se nao existir
if not exist "%APP_ROOT%\.env" (
    if exist "%APP_ROOT%\env.sample" (
        copy /Y "%APP_ROOT%\env.sample" "%APP_ROOT%\.env" >nul
        echo [OK] Arquivo .env criado a partir de env.sample
        echo [AVISO] Ajuste as credenciais no arquivo .env antes de iniciar o servidor
    ) else (
        echo [AVISO] Arquivo .env nao encontrado
        echo [AVISO] Crie um arquivo .env com as configuracoes necessarias
    )
) else (
    echo [OK] Arquivo .env ja existe
)

echo.
echo ==================================================
echo   Instalacao concluida!
echo ==================================================
echo.
echo Para iniciar o servidor, execute:
echo   node server.js
echo.
echo Ou use: npm start
echo.
pause
