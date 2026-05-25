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

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node' -ArgumentList 'scripts\web-runner-server.js' -WorkingDirectory (Join-Path '%~dp0' 'WSOP-Web-Automation') -WindowStyle Hidden"
exit /b 0
