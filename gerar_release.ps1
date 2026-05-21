# =============================================================================
# Consulta NF-e (Desktop) — Empacota release (mesmo conteúdo do GitHub Actions)
#
# Lista de arquivos: scripts/release-manifest.json
#
#   .\gerar_release.ps1 -Bump patch
#   .\gerar_release.ps1 -Bump patch -Publicar -RepoOwner usuario -RepoName consulta_nfe
#
# Ou só o ZIP atual (sem bump):
#   npm run release:pack
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

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$versao = $pkg.version

Write-Host "[INFO] Empacotando manifest -> dist\consulta_nfe.zip" -ForegroundColor Cyan
Push-Location $PSScriptRoot
try {
    npm run release:pack
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}

$zipFinal = Join-Path $PSScriptRoot 'dist\consulta_nfe.zip'
if (-not (Test-Path $zipFinal)) {
    Write-Error "ZIP nao gerado em $zipFinal"
}
Write-Host "[OK] $zipFinal ($([math]::Round((Get-Item $zipFinal).Length / 1MB, 2)) MB)" -ForegroundColor Green

$gitOk = Test-Path (Join-Path $PSScriptRoot '.git')
if ($Bump -ne 'none' -and $gitOk) {
    git add package.json package-lock.json
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
    }
    elseif ($gitOk) {
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
