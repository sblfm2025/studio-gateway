@echo off
cd /d "%~dp0"
set PATH=%PATH%;C:\Program Files\nodejs
title RadioBOSS Firestore Gateway Agent
echo ==================================================
echo   RadioBOSS Firestore Gateway Agent Startup Script
echo ==================================================
echo.

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
exit /b 0

:CompileError
echo [ERROR] Gagal melakukan kompilasi TypeScript!
exit /b 1
