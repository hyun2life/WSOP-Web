@echo off
setlocal
title WSOP Web Setup

cd /d "%~dp0"

echo ==================================================
echo [WSOP Web] Setup
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not available in PATH.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available in PATH.
  echo Reinstall Node.js LTS or restart the terminal, then run this file again.
  pause
  exit /b 1
)

echo [1/4] Installing Web Automation npm packages...
pushd "WSOP-Web-Automation"
call npm install
if errorlevel 1 (
  popd
  echo [ERROR] Web Automation npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Installing Web Automation Playwright browser...
call npx playwright install chromium
if errorlevel 1 (
  popd
  echo [ERROR] Web Automation Playwright browser install failed.
  pause
  exit /b 1
)
popd

echo.
echo [3/4] Installing Player Standings Crawler npm packages...
pushd "WSOP-Player-Standings-Crawler"
call npm install
if errorlevel 1 (
  popd
  echo [ERROR] Player Standings Crawler npm install failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Installing Player Standings Crawler Playwright browser...
call npx playwright install chromium
if errorlevel 1 (
  popd
  echo [ERROR] Player Standings Crawler Playwright browser install failed.
  pause
  exit /b 1
)
popd

echo.
echo ==================================================
echo [SETUP COMPLETED]
echo Run Run.bat from this folder to open the dashboard.
echo ==================================================
echo.
pause
exit /b 0
