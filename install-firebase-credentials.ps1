param(
    [string]$GatewayServiceAccount,
    [string]$RecordingServiceAccount,
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$envPath = Join-Path $projectRoot ".env"

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File tidak ditemukan: $Path"
    }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "File bukan JSON valid: $Path"
    }
}

function Assert-ServiceAccount([string]$Path, [string]$ExpectedProjectId, [string]$Label) {
    $json = Read-JsonFile $Path
    if ($json.type -ne "service_account") {
        throw "$Label bukan Firebase service account JSON. Field type harus service_account."
    }
    if ($json.project_id -ne $ExpectedProjectId) {
        throw "$Label project_id salah. Ditemukan '$($json.project_id)', harus '$ExpectedProjectId'."
    }
    if (-not $json.client_email -or -not $json.private_key_id) {
        throw "$Label tidak lengkap. Field client_email/private_key_id tidak ditemukan."
    }
    return $json
}

function Set-EnvValue([string]$Key, [string]$Value) {
    if (-not (Test-Path -LiteralPath $envPath)) {
        throw ".env tidak ditemukan di $envPath"
    }

    $lines = Get-Content -LiteralPath $envPath
    $escapedKey = [regex]::Escape($Key)
    $replacement = "$Key=$Value"
    $found = $false
    $updated = foreach ($line in $lines) {
        if ($line -match "^\s*$escapedKey=") {
            $found = $true
            $replacement
        } else {
            $line
        }
    }

    if (-not $found) {
        $updated += $replacement
    }

    Set-Content -LiteralPath $envPath -Value $updated
}

function Install-Credential(
    [string]$SourcePath,
    [string]$DestinationFileName,
    [string]$ExpectedProjectId,
    [string]$Label,
    [string[]]$EnvKeys
) {
    $resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
    $json = Assert-ServiceAccount $resolvedSource $ExpectedProjectId $Label
    $destinationPath = Join-Path $projectRoot $DestinationFileName

    if (-not $VerifyOnly) {
        if ($resolvedSource -ne $destinationPath) {
            Copy-Item -LiteralPath $resolvedSource -Destination $destinationPath -Force
        }
        foreach ($key in $EnvKeys) {
            Set-EnvValue $key "./$DestinationFileName"
        }
    }

    Write-Host "OK  : $Label valid untuk project '$ExpectedProjectId'"
    Write-Host "      client_email: $($json.client_email)"
    if (-not $VerifyOnly) {
        Write-Host "      dipasang ke: $destinationPath"
    }
}

Write-Host "=== Install/Verify Firebase Service Accounts Studio Gateway ==="
Write-Host "Project gateway  : radio-sbl-overlay"
Write-Host "Project recording: overlaysbl"
Write-Host ""

if (-not $GatewayServiceAccount -and -not $RecordingServiceAccount) {
    Write-Host "Tidak ada file input. Contoh pemakaian:"
    Write-Host "powershell -ExecutionPolicy Bypass -File install-firebase-credentials.ps1 -GatewayServiceAccount C:\path\gateway.json -RecordingServiceAccount C:\path\recording.json"
    Write-Host ""
    Write-Host "Status file standar saat ini:"
    foreach ($file in @("service-account-gateway.json", "service-account-recording.json")) {
        $path = Join-Path $projectRoot $file
        if (Test-Path -LiteralPath $path) {
            Write-Host "OK  : $file ditemukan"
        } else {
            Write-Host "MISS: $file belum ada"
        }
    }
    exit 0
}

if ($GatewayServiceAccount) {
    Install-Credential `
        -SourcePath $GatewayServiceAccount `
        -DestinationFileName "service-account-gateway.json" `
        -ExpectedProjectId "radio-sbl-overlay" `
        -Label "Gateway RadioBOSS" `
        -EnvKeys @(
            "FIREBASE_GATEWAY_GOOGLE_APPLICATION_CREDENTIALS",
            "FIREBASE_REQUEST_GOOGLE_APPLICATION_CREDENTIALS",
            "FIREBASE_OVERLAY_GOOGLE_APPLICATION_CREDENTIALS"
        )
}

if ($RecordingServiceAccount) {
    Install-Credential `
        -SourcePath $RecordingServiceAccount `
        -DestinationFileName "service-account-recording.json" `
        -ExpectedProjectId "overlaysbl" `
        -Label "Recording RadioBOSS" `
        -EnvKeys @(
            "RECORDING_GOOGLE_APPLICATION_CREDENTIALS",
            "FIREBASE_OVERLAY2_GOOGLE_APPLICATION_CREDENTIALS"
        )
}

Write-Host ""
Write-Host "Selesai. Jalankan 'npm.cmd run build' lalu start gateway setelah credential/rules siap."
