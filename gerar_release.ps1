# =============================================================================
# Consulta NF-e (Desktop) - Empacota release completa para clientes
#
#   .\gerar_release.ps1 -Bump patch
#   .\gerar_release.ps1 -Bump patch -Publicar -RepoOwner usuario -RepoName consulta_nfe
# =============================================================================

param(
    [ValidateSet('none', 'patch', 'minor', 'major')]
    [string]$Bump = 'none',
    [switch]$Publicar,
    [string]$RepoOwner = '',
    [string]$RepoName = 'consulta_nfe'
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$pkgPath = Join-Path $PSScriptRoot 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json

if ($Bump -ne 'none') {
    $partes = $pkg.version.Split('.')
    [int]$maj = $partes[0]; [int]$min = $partes[1]; [int]$pat = $partes[2]
    switch ($Bump) {
        'patch' { $pat++ }
        'minor' { $min++; $pat = 0 }
        'major' { $maj++; $min = 0; $pat = 0 }
    }
    $pkg.version = "$maj.$min.$pat"
    ($pkg | ConvertTo-Json -Depth 20) | Set-Content -Path $pkgPath -Encoding UTF8
    Write-Host "[INFO] Versao: $($pkg.version)" -ForegroundColor Cyan
}

$versao = $pkg.version
$distDir = Join-Path $PSScriptRoot 'dist'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$zipFinal = Join-Path $distDir 'consulta_nfe.zip'
if (Test-Path $zipFinal) { Remove-Item $zipFinal -Force }

$staging = Join-Path $env:TEMP "consulta_nfe_desktop_$(Get-Random)"
New-Item -ItemType Directory -Path $staging | Out-Null

$incluir = @(
    'server.js', 'updater.js', 'sefaz-service.js', 'nfe-parser.js', 'confnf-api.js',
    'index.html', 'detalhes.html', 'manutencao.html', 'autorizacao-recepcao-xml.html',
    'confnf.html', 'lumi.html',
    'package.json', 'package-lock.json', 'env.sample',
    'iniciar_servidor.bat', 'instalar_servico.bat', 'desinstalar_servico.bat',
    'atualizar_agora.bat', 'atualizar-consulta-nfe.bat',
    'verificar_configuracao.js',
    'MANUAL_INSTALACAO.md', 'MANUAL_ATUALIZACAO_REMOTA.md', 'SOLUCAO_ERRO_CONEXAO.md'
)

foreach ($item in $incluir) {
    $src = Join-Path $PSScriptRoot $item
    if (Test-Path $src) {
        Copy-Item $src -Destination $staging -Recurse -Force
        Write-Host "  + $item"
    }
}

Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipFinal -Force
Remove-Item $staging -Recurse -Force
Write-Host "[OK] $zipFinal ($([math]::Round((Get-Item $zipFinal).Length / 1MB, 2)) MB)" -ForegroundColor Green

$gitOk = Test-Path (Join-Path $PSScriptRoot '.git')
if ($Bump -ne 'none' -and $gitOk) {
    git add package.json
    git commit -m "release: v$versao" 2>$null | Out-Null
    git tag -f "v$versao" 2>$null | Out-Null
    Write-Host "[INFO] Tag v$versao (git local). Push: git push --follow-tags" -ForegroundColor Cyan
}

if ($Publicar) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Error "Instale o GitHub CLI: winget install GitHub.cli"
    }
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Execute: gh auth login"
    }
    $repoArg = @()
    if ($RepoOwner) {
        $repoArg = @('--repo', "${RepoOwner}/${RepoName}")
    } elseif ($gitOk) {
        $remote = (git remote get-url origin 2>$null)
        if ($remote -match 'github\.com[:/]([^/]+)/([^/.]+)') {
            $repoArg = @('--repo', "$($Matches[1])/$($Matches[2])")
        }
    }
    if ($gitOk) { git push --follow-tags 2>$null | Out-Null }
    gh release create "v$versao" $zipFinal @repoArg --title "v$versao" --notes "Consulta NF-e Desktop v$versao"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Falha ao publicar release. Verifique repo e gh auth."
    }
    Write-Host "[OK] Release v$versao publicada no GitHub." -ForegroundColor Green
}
