@echo off
echo ========================================
echo  Desinstalador do Servico Consulta NFe
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

set SERVICE_NAME=ConsultaNFe

if not exist "%~dp0nssm.exe" (
    echo [ERRO] NSSM nao encontrado!
    pause
    exit /b 1
)

echo Parando servico...
"%~dp0nssm.exe" stop %SERVICE_NAME%

echo.
echo Removendo servico...
"%~dp0nssm.exe" remove %SERVICE_NAME% confirm

echo.
echo ========================================
echo  Servico removido com sucesso!
echo ========================================
echo.
pause
