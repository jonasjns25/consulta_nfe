@echo off
echo Instalando xml2js...
cd /d "%~dp0"
call npm install xml2js
if %ERRORLEVEL% EQU 0 (
    echo xml2js instalado com sucesso!
) else (
    echo Erro ao instalar xml2js
    pause
)
