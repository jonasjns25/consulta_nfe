@echo off
REM ==============================================================================
REM Consulta NF-e - Remove o servico Windows criado por instalar_servico.bat
REM ==============================================================================
setlocal enableextensions

cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Execute como ADMINISTRADOR.
    pause
    exit /b 1
)

set NOME_SERVICO=ConsultaNFE
set NSSM_EXE=%cd%\nssm\nssm.exe

if not exist "%NSSM_EXE%" (
    echo [ERRO] nssm.exe nao encontrado em %NSSM_EXE%
    pause
    exit /b 1
)

echo [INFO] Parando servico %NOME_SERVICO%...
"%NSSM_EXE%" stop %NOME_SERVICO% >nul 2>&1
timeout /t 2 /nobreak >nul

echo [INFO] Removendo servico...
"%NSSM_EXE%" remove %NOME_SERVICO% confirm

echo.
echo Servico %NOME_SERVICO% removido.
pause
