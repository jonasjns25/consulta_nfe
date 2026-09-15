@echo off
cd /d "%~dp0"
setlocal

echo ==========================================
echo   REINICIAR CONSULTA-NFE
echo ==========================================
echo.

where pm2 >nul 2>&1
if errorlevel 1 goto :tentar_servico

echo Executando: pm2 restart consulta-nfe --update-env
echo.
call pm2 restart consulta-nfe --update-env
if not errorlevel 1 goto :ok_pm2

echo.
echo [AVISO] App "consulta-nfe" nao encontrado no PM2. Iniciando...
call pm2 start server.js --name consulta-nfe --update-env
if errorlevel 1 goto :tentar_servico
call pm2 save
goto :ok_pm2

:tentar_servico
echo.
echo [INFO] Tentando servico do Windows...
sc query ConsultaNFE >nul 2>&1
if not errorlevel 1 (
    net stop ConsultaNFE >nul 2>&1
    net start ConsultaNFE
    if not errorlevel 1 goto :ok_svc
)
sc query ConsultaNFe >nul 2>&1
if not errorlevel 1 (
    net stop ConsultaNFe >nul 2>&1
    net start ConsultaNFe
    if not errorlevel 1 goto :ok_svc
)

echo.
echo [ERRO] Nao foi possivel reiniciar.
echo  - PM2: execute este .bat com o mesmo usuario que iniciou o PM2
echo    (nao use "Executar como administrador" se o PM2 foi iniciado sem admin)
echo  - Ou instale o servico: instalar_servico.bat
goto :fim

:ok_pm2
echo.
call pm2 list
echo.
echo [OK] Servico reiniciado no PM2.
goto :fim

:ok_svc
echo.
echo [OK] Servico do Windows reiniciado.

:fim
echo.
echo ==========================================
echo Pressione qualquer tecla para fechar...
pause >nul
