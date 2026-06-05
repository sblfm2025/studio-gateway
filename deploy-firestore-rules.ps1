param(
    [ValidateSet("gateway", "recording", "all")]
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $projectRoot

function Invoke-Firebase([string[]]$ArgsList) {
    & npx.cmd firebase-tools @ArgsList
    if ($LASTEXITCODE -ne 0) {
        throw "firebase-tools gagal dengan exit code $LASTEXITCODE"
    }
}

function Test-FirebaseLogin {
    & cmd.exe /c "npx.cmd firebase-tools projects:list --json >NUL 2>NUL"
    return $LASTEXITCODE -eq 0
}

function Deploy-Rules([string]$Name, [string]$ProjectId, [string]$ConfigFile) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $ConfigFile))) {
        throw "Config tidak ditemukan: $ConfigFile"
    }

    Write-Host "Deploy Firestore Rules $Name -> $ProjectId"
    Invoke-Firebase @(
        "deploy",
        "--only", "firestore:rules",
        "--project", $ProjectId,
        "--config", $ConfigFile
    )
}

Write-Host "=== Deploy Firestore Rules Studio Gateway ==="

if (-not (Test-FirebaseLogin)) {
    Write-Warning "Firebase CLI belum login."
    Write-Host "Jalankan dulu:"
    Write-Host "npx.cmd firebase-tools login"
    Pop-Location
    exit 1
}

if ($Target -eq "gateway" -or $Target -eq "all") {
    Deploy-Rules "gateway RadioBOSS" "radio-sbl-overlay" "firebase.overlay.json"
}

if ($Target -eq "recording" -or $Target -eq "all") {
    Deploy-Rules "recording RadioBOSS" "overlaysbl" "firebase.overlay2.json"
}

Write-Host "Deploy rules selesai."
Pop-Location
