@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  Envia alteracoes locais ao GitHub e dispara o auto-release.
REM
REM  Fluxo (na ordem correta):
REM    1. git status                     (mostra o que ha para enviar)
REM    2. git add .                      (somente se houver alteracoes)
REM    3. git commit -m "..."            (mensagem solicitada ao usuario)
REM    4. git pull --rebase origin main  (traz commits do [release-bot])
REM    5. git push origin main           (workflow auto-release dispara)
REM
REM  Uso:
REM    .\enviar_github.bat                     -> pede a mensagem
REM    .\enviar_github.bat "fix: descricao"    -> usa a mensagem do parametro
REM ============================================================

cd /d "%~dp0"

echo ============================================================
echo  Consulta NFe :: Enviar alteracoes ao GitHub
echo ============================================================
echo.

REM -- 0. checa se e um repositorio git
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Esta pasta nao e um repositorio Git.
    pause
    exit /b 1
)

REM -- 1. branch atual
for /f "delims=" %%b in ('git branch --show-current 2^>nul') do set "BRANCH=%%b"
if "%BRANCH%"=="" (
    echo [ERRO] Nao foi possivel detectar a branch atual.
    pause
    exit /b 1
)
echo Branch atual: %BRANCH%
echo.

REM -- 2. status
echo [1/5] git status
git status -sb
echo.

REM -- 3. detecta alteracoes locais
set "TEM_MUDANCAS="
git diff --quiet
if errorlevel 1 set "TEM_MUDANCAS=1"
git diff --cached --quiet
if errorlevel 1 set "TEM_MUDANCAS=1"
for /f "delims=" %%u in ('git ls-files --others --exclude-standard 2^>nul') do (
    set "TEM_MUDANCAS=1"
    goto :fim_check_mudancas
)
:fim_check_mudancas

if not defined TEM_MUDANCAS (
    echo Nada para commitar localmente. Apenas sincronizando com o remote...
    echo.
    git pull --rebase origin %BRANCH%
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha no pull.
        pause
        exit /b 1
    )
    echo.
    git push origin %BRANCH%
    echo.
    echo Repositorio sincronizado. Nada novo foi enviado.
    pause
    exit /b 0
)

REM -- 4. mensagem de commit
set "MSG=%~1"
if "%MSG%"=="" (
    echo.
    set /p MSG="Mensagem do commit: "
)
if "%MSG%"=="" (
    echo [ERRO] Mensagem vazia. Abortado.
    pause
    exit /b 1
)
echo.

REM -- 5. add + commit
echo [2/5] git add .
git add .
if errorlevel 1 (
    echo [ERRO] Falha no git add.
    pause
    exit /b 1
)

echo [3/5] git commit -m "%MSG%"
git commit -m "%MSG%"
if errorlevel 1 echo [AVISO] Nada novo para commitar -- talvez tudo esteja ignorado.
echo.

REM -- 6. pull com rebase (agora seguro, working tree limpo)
echo [4/5] git pull --rebase origin %BRANCH%
git pull --rebase origin %BRANCH%
if errorlevel 1 (
    echo.
    echo [ERRO] Conflito durante o rebase. Resolva manualmente:
    echo        - edite os arquivos em conflito
    echo        - git add ^<arquivos^>
    echo        - git rebase --continue
    echo        - depois rode: git push origin %BRANCH%
    pause
    exit /b 1
)
echo.

REM -- 7. push
echo [5/5] git push origin %BRANCH%
git push origin %BRANCH%
if errorlevel 1 (
    echo.
    echo [ERRO] Falha no push. Verifique conexao / autenticacao.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Push concluido com sucesso.
echo ------------------------------------------------------------
echo  GitHub Actions ira gerar a nova release automaticamente.
echo.
echo  Acompanhe em:
echo    https://github.com/jonasjns25/consulta_nfe/actions
echo    https://github.com/jonasjns25/consulta_nfe/releases
echo ============================================================
echo.
pause
endlocal
