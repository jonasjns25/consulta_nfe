@echo off
cd /d "%~dp0"
echo Compilando projeto...
dotnet build SACGerencial.sln -c Debug
if %ERRORLEVEL% NEQ 0 (
    echo Erro na compilacao!
    pause
    exit /b 1
)
echo.
echo Executando aplicacao...
start "" "SACGerencial\bin\Debug\net8.0-windows\SACGerencial.exe"
pause

