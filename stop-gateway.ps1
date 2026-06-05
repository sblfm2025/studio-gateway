$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$taskName = "RadioSBL Studio Gateway Agent"

Write-Host "=== Stop RadioSBL Studio Gateway Agent ==="

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    try {
        Disable-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
        Write-Host "OK  : Scheduled Task disabled: $taskName"
    } catch {
        Write-Warning "Gagal disable Scheduled Task. Jalankan PowerShell sebagai user yang memasang task atau gunakan Task Scheduler GUI."
    }
} else {
    Write-Host "INFO: Scheduled Task tidak ditemukan: $taskName"
}

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Get-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue
    Write-Host "OK  : HKCU Run entry dihapus: $taskName"
}

$targets = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*dist*index.js*") -or
    ($_.Name -eq "cmd.exe" -and ($_.CommandLine -like "*START-~1.BAT*" -or $_.CommandLine -like "*start-gateway.bat*"))
}

if ($targets) {
    foreach ($target in $targets) {
        try {
            Stop-Process -Id $target.ProcessId -Force
            Write-Host "OK  : Proses dihentikan PID $($target.ProcessId) $($target.Name)"
        } catch {
            Write-Warning "Gagal menghentikan PID $($target.ProcessId): $_"
        }
    }
} else {
    Write-Host "OK  : Tidak ada proses gateway aktif."
}

$lockDir = Join-Path $projectRoot ".gateway-start.lock"
if (Test-Path -LiteralPath $lockDir) {
    Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "OK  : Startup lock dibersihkan."
}

Write-Host "Selesai. Gateway sekarang dalam mode maintenance/offline."
