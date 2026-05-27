@echo off
setlocal EnableExtensions EnableDelayedExpansion
title WSOP Web Dashboard

cd /d "%~dp0"

set "OUTPUT_DIR=WSOP-Web-Automation\automation\output"
set "SERVER_OUT_LOG=%CD%\%OUTPUT_DIR%\web-runner-server.out.log"
set "SERVER_ERR_LOG=%CD%\%OUTPUT_DIR%\web-runner-server.err.log"

if not exist "WSOP-Web-Automation\scripts\web-runner-server.js" (
  echo [ERROR] Dashboard server script was not found.
  echo Expected: WSOP-Web-Automation\scripts\web-runner-server.js
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not available in PATH.
  echo Run Setup.bat after installing Node.js LTS.
  pause
  exit /b 1
)

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

rem 1. Check if port 3000 is already listening
call :IsDashboardPortOpen
if %errorlevel% equ 0 (
  echo [INFO] Dashboard server is already running on port 3000.
  echo Opening dashboard in browser...
  start http://localhost:3000
  exit /b 0
)

rem 2. Start the server in a hidden window
echo [INFO] Starting WSOP Web Dashboard server...
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "cd WSOP-Web-Automation; node scripts\web-runner-server.js > automation\output\web-runner-server.out.log 2> automation\output\web-runner-server.err.log"

rem 3. Wait for server to initialize
for /l %%i in (1,1,10) do (
  call :IsDashboardPortOpen
  if !errorlevel! equ 0 goto SERVER_READY
  timeout /t 1 /nobreak >nul
)

echo [WARNING] Server was started, but port 3000 is not active yet.
echo Please check the server logs:
echo   %SERVER_OUT_LOG%
echo   %SERVER_ERR_LOG%
echo Then open http://localhost:3000 manually if the browser does not open.
exit /b 0

:SERVER_READY
echo [SUCCESS] Dashboard server started successfully.
start http://localhost:3000

exit /b 0

:IsDashboardPortOpen
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
exit /b %errorlevel%
