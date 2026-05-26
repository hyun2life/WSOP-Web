@echo off
setlocal EnableExtensions EnableDelayedExpansion
title WSOP Web Dashboard Force Stop

cd /d "%~dp0"

echo [INFO] Searching for WSOP Web Dashboard server processes...

set "PID_LIST="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*web-runner-server.js*' } | ForEach-Object { $_.ProcessId }"`) do (
  set "PID_LIST=!PID_LIST! %%P"
)

if "!PID_LIST!"=="" (
  echo [INFO] No WSOP Web Dashboard server process was found.
  echo [INFO] Nothing to stop.
  pause
  exit /b 0
)

echo [WARNING] Found dashboard server process ID(s):!PID_LIST!
echo [WARNING] This will force-stop the dashboard server and any child process started by it.
echo [WARNING] If a test is currently running from the dashboard, it may be terminated too.
set /p CONFIRM=Type Y to force stop the dashboard: 

if /i not "!CONFIRM!"=="Y" (
  echo [INFO] Cancelled. No process was stopped.
  pause
  exit /b 0
)

for %%P in (!PID_LIST!) do (
  echo [INFO] Stopping process tree for PID %%P...
  taskkill /PID %%P /T /F
)

echo [SUCCESS] Dashboard force-stop request completed.
pause
exit /b 0
