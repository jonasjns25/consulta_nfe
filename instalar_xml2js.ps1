Write-Host "Instalando xml2js..." -ForegroundColor Yellow
Write-Host ""

$currentDir = Get-Location
Set-Location $PSScriptRoot

try {
    $output = npm install xml2js 2>&1
    Write-Host $output
    
    if (Test-Path "node_modules\xml2js") {
        Write-Host ""
        Write-Host "xml2js instalado com sucesso!" -ForegroundColor Green
        Write-Host "Agora você pode executar: npm start" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Erro: xml2js não foi instalado corretamente." -ForegroundColor Red
        Write-Host "Tente executar manualmente: npm install xml2js" -ForegroundColor Yellow
    }
} catch {
    Write-Host ""
    Write-Host "Erro ao instalar xml2js: $_" -ForegroundColor Red
    Write-Host "Tente executar manualmente: npm install xml2js" -ForegroundColor Yellow
} finally {
    Set-Location $currentDir
}

