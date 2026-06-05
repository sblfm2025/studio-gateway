$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$envPath = Join-Path $projectRoot ".env"

function Write-Result([string]$Level, [string]$Message) {
    $prefix = switch ($Level) {
        "OK" { "OK  " }
        "WARN" { "WARN" }
        "FAIL" { "FAIL" }
        default { "INFO" }
    }
    Write-Host "${prefix}: $Message"
}

function Read-EnvFile {
    $map = @{}
    if (-not (Test-Path -LiteralPath $envPath)) {
        Write-Result "FAIL" ".env tidak ditemukan"
        return $map
    }
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([^=]+)=(.*)$') {
            $map[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    return $map
}

function Resolve-ProjectPath([string]$Value) {
    if (-not $Value) { return "" }
    if ([System.IO.Path]::IsPathRooted($Value)) { return $Value }
    return Join-Path $projectRoot $Value
}

function Check-ServiceAccount([string]$Label, [string]$PathValue, [string]$ExpectedProjectId, [bool]$Required) {
    if (-not $PathValue) {
        if ($Required) {
            Write-Result "FAIL" "$Label credential belum diisi"
        } else {
            Write-Result "WARN" "$Label credential belum diisi"
        }
        return
    }

    $path = Resolve-ProjectPath $PathValue
    if (-not (Test-Path -LiteralPath $path)) {
        if ($Required) {
            Write-Result "FAIL" "$Label credential tidak ditemukan: $PathValue"
        } else {
            Write-Result "WARN" "$Label credential tidak ditemukan: $PathValue"
        }
        return
    }

    try {
        $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($json.type -ne "service_account") {
            Write-Result "FAIL" "$Label bukan service_account JSON"
            return
        }
        if ($json.project_id -ne $ExpectedProjectId) {
            Write-Result "FAIL" "$Label project_id '$($json.project_id)', harus '$ExpectedProjectId'"
            return
        }
        Write-Result "OK" "$Label credential valid untuk '$ExpectedProjectId'"
    } catch {
        Write-Result "FAIL" "$Label credential tidak bisa dibaca sebagai JSON"
    }
}

Push-Location $projectRoot
Write-Host "=== RadioSBL Studio Gateway Go-Live Check ==="

$env = Read-EnvFile

Write-Host ""
Write-Host "-- Build dan proses --"
if (Test-Path -LiteralPath (Join-Path $projectRoot "dist\index.js")) {
    Write-Result "OK" "dist\index.js ditemukan"
} else {
    Write-Result "FAIL" "dist\index.js belum ada. Jalankan npm.cmd run build"
}

$gatewayProcesses = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*dist*index.js*") -or
    ($_.Name -eq "cmd.exe" -and ($_.CommandLine -like "*START-~1.BAT*" -or $_.CommandLine -like "*start-gateway.bat*"))
}
if ($gatewayProcesses) {
    foreach ($process in $gatewayProcesses) {
        Write-Result "INFO" "Gateway process aktif: PID $($process.ProcessId) $($process.Name)"
    }
} else {
    Write-Result "WARN" "Gateway process tidak aktif"
}

Write-Host ""
Write-Host "-- Autostart Windows --"
$task = Get-ScheduledTask -TaskName "RadioSBL Studio Gateway Agent" -ErrorAction SilentlyContinue
if ($task) {
    Write-Result "INFO" "Scheduled Task state: $($task.State)"
} else {
    Write-Result "WARN" "Scheduled Task belum terdaftar"
}
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValue = (Get-ItemProperty -Path $runKey -Name "RadioSBL Studio Gateway Agent" -ErrorAction SilentlyContinue).'RadioSBL Studio Gateway Agent'
if ($runValue) {
    Write-Result "OK" "HKCU Run autostart aktif: $runValue"
} elseif ($task -and $task.State -ne "Disabled") {
    Write-Result "OK" "Autostart aktif via Scheduled Task"
} else {
    Write-Result "WARN" "Autostart belum aktif"
}

Write-Host ""
Write-Host "-- Firebase mapping --"
Write-Result "INFO" "FIREBASE_PROJECT_ID=$($env.FIREBASE_PROJECT_ID)"
Write-Result "INFO" "FIREBASE_GATEWAY_PROJECT_ID=$($env.FIREBASE_GATEWAY_PROJECT_ID)"
Write-Result "INFO" "RECORDING_FIREBASE_PROJECT_ID=$($env.RECORDING_FIREBASE_PROJECT_ID)"
Write-Result "INFO" "FIRESTORE_ROUTE_GATEWAY=$($env.FIRESTORE_ROUTE_GATEWAY)"
Write-Result "INFO" "FIRESTORE_ROUTE_RECORDING=$($env.FIRESTORE_ROUTE_RECORDING)"
Write-Result "INFO" "FIREBASE_ALLOW_CLIENT_SDK_WRITES=$($env.FIREBASE_ALLOW_CLIENT_SDK_WRITES)"

Check-ServiceAccount "Firebase utama" $env.GOOGLE_APPLICATION_CREDENTIALS "radiosbl" $true
Check-ServiceAccount "Firebase gateway RadioBOSS" $env.FIREBASE_GATEWAY_GOOGLE_APPLICATION_CREDENTIALS "radio-sbl-overlay" $false
Check-ServiceAccount "Firebase recording" $env.RECORDING_GOOGLE_APPLICATION_CREDENTIALS "overlaysbl" $false

Write-Host ""
Write-Host "-- Rules files --"
foreach ($file in @("firestore.overlay.rules", "firestore.overlay2.rules", "firebase.overlay.json", "firebase.overlay2.json")) {
    if (Test-Path -LiteralPath (Join-Path $projectRoot $file)) {
        Write-Result "OK" "$file ditemukan"
    } else {
        Write-Result "FAIL" "$file tidak ditemukan"
    }
}

Write-Host ""
Write-Host "-- Firebase CLI --"
$firebaseVersion = & npx.cmd firebase-tools --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Result "OK" "firebase-tools via npx tersedia: $firebaseVersion"
} else {
    Write-Result "WARN" "firebase-tools via npx belum tersedia"
}

$projectsJson = & npx.cmd firebase-tools projects:list --json 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Result "OK" "Firebase CLI sudah login"
} else {
    Write-Result "WARN" "Firebase CLI belum login. Jalankan: npx.cmd firebase-tools login"
}

Write-Host ""
Write-Host "Selesai."
Pop-Location
