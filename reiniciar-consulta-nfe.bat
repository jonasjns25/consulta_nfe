@echo off
setlocal enableextensions
cd /d "%~dp0"
set "DIR_PROJETO=%cd%"

echo ==========================================
echo   REINICIAR CONSULTA-NFE
echo   Pasta: %DIR_PROJETO%
echo ==========================================
echo.

if not exist "%DIR_PROJETO%\.env" (
    echo [AVISO] Arquivo .env nao encontrado nesta pasta.
    echo         Coloque o .env junto de server.js antes de reiniciar.
    echo.
) else (
    call :mostrar_env
    echo.
)

set "REINICIOU=0"
set "NOME_SERVICO="

REM --- Servico Windows em execucao tem prioridade (instalar_servico.bat) ---
for %%S in (ConsultaNFE ConsultaNFe) do (
    sc query %%S 2>nul | findstr /C:"RUNNING" >nul 2>&1
    if not errorlevel 1 (
        set "NOME_SERVICO=%%S"
        goto :reiniciar_servico
    )
)

REM --- PM2 registrado (delete + start recarrega o .env; restart --update-env nao le o arquivo) ---
where pm2 >nul 2>&1
if not errorlevel 1 (
    pm2 describe consulta-nfe >nul 2>&1
    if not errorlevel 1 goto :reiniciar_pm2
)

REM --- Servico instalado (parado) ---
for %%S in (ConsultaNFE ConsultaNFe) do (
    sc query %%S >nul 2>&1
    if not errorlevel 1 (
        set "NOME_SERVICO=%%S"
        goto :reiniciar_servico
    )
)

REM --- PM2 no PATH mas app ainda nao criado ---
where pm2 >nul 2>&1
if not errorlevel 1 goto :reiniciar_pm2

echo [ERRO] Nao foi possivel reiniciar.
echo  - Instale o servico: instalar_servico.bat
echo  - Ou inicie com PM2: pm2 start server.js --name consulta-nfe --cwd "%DIR_PROJETO%"
goto :fim

:reiniciar_servico
echo [INFO] Reiniciando servico Windows %NOME_SERVICO%...
echo       (novo processo Node.js le o .env desta pasta)
echo.
net stop %NOME_SERVICO% >nul 2>&1
timeout /t 3 /nobreak >nul
net start %NOME_SERVICO%
if errorlevel 1 (
    echo [ERRO] Falha ao iniciar %NOME_SERVICO%. Veja logs\server-erro.log
    goto :fim
)
set "REINICIOU=1"
echo.
echo [OK] Servico %NOME_SERVICO% reiniciado.
goto :pos_reinicio

:reiniciar_pm2
pm2 describe consulta-nfe >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Parando e removendo processo PM2 "consulta-nfe"...
    call pm2 stop consulta-nfe >nul 2>&1
    timeout /t 2 /nobreak >nul
    call pm2 delete consulta-nfe >nul 2>&1
) else (
    echo [INFO] App PM2 "consulta-nfe" nao existia; criando novo...
)

echo [INFO] Iniciando PM2 com cwd=%DIR_PROJETO%
call pm2 start server.js --name consulta-nfe --cwd "%DIR_PROJETO%"
if errorlevel 1 goto :tentar_servico_parado

call pm2 save >nul 2>&1
set "REINICIOU=1"
echo.
call pm2 list
echo.
echo [OK] PM2 reiniciado (processo novo = .env relido).
goto :pos_reinicio

:tentar_servico_parado
echo.
echo [AVISO] PM2 falhou. Tentando servico Windows...
set "NOME_SERVICO="
for %%S in (ConsultaNFE ConsultaNFe) do (
    sc query %%S >nul 2>&1
    if not errorlevel 1 (
        set "NOME_SERVICO=%%S"
        goto :reiniciar_servico
    )
)
echo [ERRO] PM2 e servico Windows indisponiveis.
echo  - PM2: use o mesmo usuario que criou o app (evite admin se PM2 foi sem admin)
goto :fim

:pos_reinicio
if "%REINICIOU%"=="1" if exist "%DIR_PROJETO%\.env" (
    echo.
    echo Configuracao lida do .env apos reinicio:
    call :mostrar_env
)

:fim
echo.
echo ==========================================
echo Pressione qualquer tecla para fechar...
pause >nul
exit /b 0

:mostrar_env
where node >nul 2>&1
if errorlevel 1 (
    echo [INFO] Node.js nao encontrado para exibir preview do .env.
    exit /b 0
)
node -p "try{require('dotenv').config({path:require('path').join(process.cwd(),'.env'),override:true});'  NFE_PULAR_LOGIN='+(process.env.NFE_PULAR_LOGIN||'(nao definido)')+'\n  PORT='+(process.env.PORT||'3000')}catch(e){'  (erro ao ler .env: '+e.message+')'}"
exit /b 0
