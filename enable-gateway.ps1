param(
    [switch]$StartNow
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$taskName = "RadioSBL Studio Gateway Agent"

Write-Host "=== Enable RadioSBL Studio Gateway Agent ==="

$buildPath = Join-Path $projectRoot "dist\index.js"
if (-not (Test-Path -LiteralPath $buildPath)) {
    Write-Warning "dist\index.js belum ada. Jalankan npm.cmd run build sebelum menyalakan gateway."
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    try {
        Enable-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
        Write-Host "OK  : Scheduled Task enabled: $taskName"
    } catch {
        Write-Warning "Gagal enable Scheduled Task. Jalankan PowerShell sebagai user yang memasang task atau gunakan Task Scheduler GUI."
    }
} else {
    Write-Warning "Scheduled Task belum terdaftar. Jalankan: npm.cmd run install-autostart"
}

if ($StartNow) {
    $running = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "node.exe" -and $_.CommandLine -like "*dist*index.js*"
    }
    if ($running) {
        foreach ($process in $running) {
            Write-Host "INFO: Gateway sudah aktif PID $($process.ProcessId)"
        }
    } elseif ($task) {
        try {
            Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
            Write-Host "OK  : Scheduled Task distart."
        } catch {
            Write-Warning "Scheduled Task tidak bisa distart. Menjalankan start-gateway.bat langsung."
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c start-gateway.bat" -WorkingDirectory $projectRoot -WindowStyle Hidden
            Write-Host "OK  : start-gateway.bat dijalankan langsung."
        }
    } else {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c start-gateway.bat" -WorkingDirectory $projectRoot -WindowStyle Hidden
        Write-Host "OK  : start-gateway.bat dijalankan langsung."
    }
} else {
    Write-Host "INFO: Autostart sudah di-enable. Tambahkan -StartNow jika ingin langsung menyalakan agent."
}
