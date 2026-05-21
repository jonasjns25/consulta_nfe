@echo off
cd /d "%~dp0"

echo ==========================================
echo   REINICIAR CONSULTA-NFE
echo ==========================================
echo.
echo Executando: pm2 restart consulta-nfe
echo.

call pm2 restart consulta-nfe 2>&1
set R=%errorlevel%

echo.
if %R%==0 (
    echo [OK] Servico reiniciado com sucesso.
) else (
    echo [ERRO] Falha ao reiniciar. Codigo: %R%
    echo Verifique se o PM2 e o app consulta-nfe estao instalados.
)
echo.
echo ==========================================
echo Pressione qualquer tecla para fechar...
pause >nul
