@echo off
setlocal
title WSOP Web Dashboard

cd /d "%~dp0"

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

rem 1. Check if port 3000 is already in use
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
  echo [INFO] Dashboard server is already running on port 3000.
  echo Opening dashboard in browser...
  start http://localhost:3000
  exit /b 0
)

rem 2. Start the server in a hidden window
echo [INFO] Starting WSOP Web Dashboard server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node' -ArgumentList 'scripts\web-runner-server.js' -WorkingDirectory 'WSOP-Web-Automation' -WindowStyle Hidden"

rem 3. Wait a moment for server to initialize
timeout /t 2 /nobreak >nul

rem 4. Verify if port 3000 is open now, and launch browser
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
  echo [SUCCESS] Dashboard server started successfully.
  start http://localhost:3000
) else (
  echo [WARNING] Server was started, but port 3000 is not active yet.
  echo Please open http://localhost:3000 manually if the browser does not open.
)

exit /b 0
