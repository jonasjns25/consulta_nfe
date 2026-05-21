# ==============================================================================
# Consulta NF-e - Setup PowerShell
# Script robusto para instalação no Windows
# ==============================================================================

$ErrorActionPreference = "Stop"

# Mudar para o diretório do script
Set-Location $PSScriptRoot
$APP_ROOT = Get-Location

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Consulta NF-e :: Instalação" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Verificar Node.js
try {
    $nodeVersion = node -v 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Node.js encontrado: $nodeVersion" -ForegroundColor Green
    } else {
        throw "Node.js não encontrado"
    }
} catch {
    Write-Host "[ERRO] Node.js não encontrado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Por favor, instale o Node.js manualmente:" -ForegroundColor Yellow
    Write-Host "1. Acesse: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "2. Baixe e instale a versão LTS" -ForegroundColor Yellow
    Write-Host "3. Execute este script novamente" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 1
}

# Verificar package.json
if (-not (Test-Path "$APP_ROOT\package.json")) {
    Write-Host "[ERRO] package.json não encontrado!" -ForegroundColor Red
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 1
}

Write-Host "[OK] package.json encontrado" -ForegroundColor Green
Write-Host ""

# Instalar dependências
Write-Host "[INFO] Instalando dependências..." -ForegroundColor Yellow
Write-Host ""

try {
    npm install
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao instalar dependências"
    }
    Write-Host ""
    Write-Host "[OK] Dependências instaladas" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[ERRO] Falha ao instalar dependências" -ForegroundColor Red
    Write-Host "Verifique sua conexão com a internet e tente novamente" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 1
}

Write-Host ""

# Criar arquivo .env se não existir
if (-not (Test-Path "$APP_ROOT\.env")) {
    if (Test-Path "$APP_ROOT\env.sample") {
        Copy-Item "$APP_ROOT\env.sample" "$APP_ROOT\.env" -Force
        Write-Host "[OK] Arquivo .env criado a partir de env.sample" -ForegroundColor Green
        Write-Host "[AVISO] Ajuste as credenciais no arquivo .env antes de iniciar o servidor" -ForegroundColor Yellow
    } else {
        Write-Host "[AVISO] Arquivo .env não encontrado" -ForegroundColor Yellow
        Write-Host "[AVISO] Crie um arquivo .env com as configurações necessárias" -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] Arquivo .env já existe" -ForegroundColor Green
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Instalação concluída!" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para iniciar o servidor, execute:" -ForegroundColor Yellow
Write-Host "  node server.js" -ForegroundColor White
Write-Host ""
Write-Host "Ou use: npm start" -ForegroundColor White
Write-Host ""

Read-Host "Pressione Enter para sair"

