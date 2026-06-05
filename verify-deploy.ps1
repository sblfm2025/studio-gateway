<#
verify-deploy.ps1
Skrip verifikasi cepat untuk memastikan agen terpasang dan berjalan setelah autostart.
Jalankan di PC Studio setelah login untuk memeriksa Task Scheduler, Run key, proses node, dan log.
#>

Write-Host "=== Verifikasi Deploy RadioSBL Studio Gateway Agent ==="

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $projectRoot

function Check-FileExists([string]$p) {
    if (Test-Path $p) { Write-Host "OK  : File ditemukan -> $p" } else { Write-Warning "MISSING: File tidak ditemukan -> $p" }
}

Write-Host "-- Memeriksa keberadaan berkas build --"
Check-FileExists -p "dist\index.js"

Write-Host "-- Memeriksa Scheduled Task (Task Scheduler) --"
try {
    $taskName = 'RadioSBL Studio Gateway Agent'
    $task = schtasks /Query /TN "$taskName" 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "OK  : Scheduled Task terdaftar: $taskName" } else { Write-Warning "NOT FOUND: Scheduled Task $taskName"; Write-Host $task }
} catch {
    Write-Warning "Gagal memeriksa scheduled task: $_"
}

Write-Host "-- Memeriksa entri HKCU Run (autorun) --"
try {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $vals = Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
    if ($vals -and $vals.'RadioSBL Studio Gateway Agent') {
        Write-Host "OK  : HKCU Run entry ditemukan -> $($vals.'RadioSBL Studio Gateway Agent')"
    } else {
        Write-Host "INFO: HKCU Run entry tidak ditemukan untuk nama 'RadioSBL Studio Gateway Agent'"
    }
} catch {
    Write-Warning "Gagal membaca HKCU Run: $_"
}

Write-Host "-- Memeriksa proses node yang menjalankan dist/index.js --"
try {
    $procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'dist\\index.js' }
    if ($procs) {
        foreach ($p in $procs) {
            Write-Host "OK  : Proses node ditemukan (PID:$($p.ProcessId)) -> $($p.CommandLine)"
        }
    } else {
        Write-Warning "Tidak ada proses node yang menjalankan dist\index.js terdeteksi."
    }
} catch {
    Write-Warning "Gagal memeriksa proses: $_"
}

Write-Host "-- Menampilkan tail log (jika ada) --"
if (Test-Path "gateway.log") {
    Write-Host "Terakhir 50 baris dari gateway.log:"
    Get-Content gateway.log -Tail 50 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "gateway.log tidak ditemukan di folder proyek."
}

if (Test-Path "vbs-run.log") {
    Write-Host "\nTerakhir 50 baris dari vbs-run.log:"
    Get-Content vbs-run.log -Tail 50 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "vbs-run.log tidak ditemukan (jika start-hidden.vbs belum pernah dijalankan, ini normal)."
}

Write-Host "\nSelesai verifikasi lokal. Jika semua OK, agen harus berjalan setelah login pengguna."
Pop-Location
