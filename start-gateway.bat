@echo off
cd /d "%~dp0"
set PATH=%PATH%;C:\Program Files\nodejs
set "EXIT_CODE=0"
title RadioBOSS Firestore Gateway Agent
echo ==================================================
echo   RadioBOSS Firestore Gateway Agent Startup Script
echo ==================================================
echo.

echo [0/2] Memeriksa proses gateway yang sudah berjalan...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine -like '*dist*index.js*' }; if ($existing) { Write-Host '[INFO] Gateway sudah berjalan. Startup baru dibatalkan agar tidak dobel.'; exit 10 }"
if errorlevel 10 exit /b 0

set "LOCK_DIR=%~dp0.gateway-start.lock"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lock='%LOCK_DIR%'; $ownerFile=Join-Path $lock 'owner.pid'; if (Test-Path -LiteralPath $lock) { $owner = if (Test-Path -LiteralPath $ownerFile) { Get-Content -LiteralPath $ownerFile -ErrorAction SilentlyContinue | Select-Object -First 1 } else { '' }; if ($owner -match '^\d+$' -and (Get-Process -Id ([int]$owner) -ErrorAction SilentlyContinue)) { Write-Host '[INFO] Startup gateway lain sedang berjalan. Startup ini dibatalkan.'; exit 20 }; Write-Host '[INFO] Menghapus startup lock lama yang tertinggal.'; Remove-Item -LiteralPath $lock -Recurse -Force -ErrorAction SilentlyContinue }; New-Item -ItemType Directory -Path $lock -Force | Out-Null; $cmdPid=(Get-CimInstance Win32_Process -Filter \"ProcessId=$PID\").ParentProcessId; Set-Content -LiteralPath $ownerFile -Value $cmdPid"
if errorlevel 20 exit /b 0
if errorlevel 1 exit /b 1

echo [1/2] Mengompilasi kode TypeScript ke JavaScript...
call node node_modules\typescript\bin\tsc
if errorlevel 1 goto CompileError
goto StartAgent

:StartAgent
if not exist dist\index.js goto CompileError
echo.
echo [2/2] Memulai Agen Gateway secara terus menerus...
echo.
call node dist\index.js
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" goto Cleanup
if /i "%GATEWAY_RESTART_ON_CRASH%"=="false" goto Cleanup
echo.
echo [WARN] Agen Gateway berhenti dengan kode %EXIT_CODE%. Restart otomatis dalam 60 detik...
timeout /t 60 /nobreak >nul
goto StartAgent

:CompileError
echo [ERROR] Gagal melakukan kompilasi TypeScript!
set "EXIT_CODE=1"
goto Cleanup

:Cleanup
if exist "%LOCK_DIR%" rmdir /s /q "%LOCK_DIR%" >nul 2>&1
exit /b %EXIT_CODE%
