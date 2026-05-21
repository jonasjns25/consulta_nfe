# Script para verificar se o servidor Node.js está acessível

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Verificação do Servidor NF-e" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Ler configuração
$configPath = "config.env"
if (-not (Test-Path $configPath)) {
    Write-Host "ERRO: Arquivo config.env não encontrado!" -ForegroundColor Red
    Write-Host "Crie o arquivo config.env na raiz do projeto." -ForegroundColor Yellow
    exit 1
}

# Ler porta do config.env
$port = 9000
$apiHost = "localhost"

$configContent = Get-Content $configPath
foreach ($line in $configContent) {
    if ($line -match "^PORT=(.+)$") {
        $port = $matches[1].Trim()
    }
    if ($line -match "^API_HOST=(.+)$") {
        $apiHost = $matches[1].Trim()
    }
}

Write-Host "Configuração encontrada:" -ForegroundColor Green
Write-Host "  API_HOST: $apiHost" -ForegroundColor White
Write-Host "  PORT: $port" -ForegroundColor White
Write-Host ""

# Testar conexão
$url = "http://${apiHost}:${port}"
Write-Host "Testando conexão com: $url" -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 5 -UseBasicParsing
    Write-Host "✓ Servidor está respondendo!" -ForegroundColor Green
    Write-Host "  Status: $($response.StatusCode)" -ForegroundColor White
    Write-Host ""
    Write-Host "O servidor Node.js está funcionando corretamente." -ForegroundColor Green
    Write-Host "Você pode executar o aplicativo desktop agora." -ForegroundColor Green
} catch {
    Write-Host "✗ ERRO: Servidor não está acessível!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Possíveis causas:" -ForegroundColor Yellow
    Write-Host "  1. Servidor Node.js não está rodando" -ForegroundColor White
    Write-Host "     Execute: node server.js" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  2. Porta incorreta no config.env" -ForegroundColor White
    Write-Host "     Verifique se PORT=$port está correto" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  3. Firewall bloqueando a porta $port" -ForegroundColor White
    Write-Host "     Verifique as configurações de firewall" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  4. Servidor em outro host" -ForegroundColor White
    Write-Host "     Verifique se API_HOST=$apiHost está correto" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Erro detalhado: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

