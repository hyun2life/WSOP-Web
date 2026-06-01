@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "AUTO_ROOT=%CD%"
set "WEB_AUTO_DIR=%AUTO_ROOT%\WSOP-Web-Automation"
set "CRAWLER_OUTPUT_DIR=%AUTO_ROOT%\WSOP-Player-Standings-Crawler\automation\output"
set "WEB_OUTPUT_DIR=%WEB_AUTO_DIR%\automation\output"

if not exist "%WEB_AUTO_DIR%\package.json" (
  echo [ERROR] WSOP-Web-Automation package.json not found.
  echo Current root: %AUTO_ROOT%
  pause
  exit /b 1
)

set "LIVE_FILE="
set "STAGE_FILE="

if not "%~1"=="" (
  set "LIVE_FILE=%~f1"
)
if not "%~2"=="" (
  set "STAGE_FILE=%~f2"
)

if not "%LIVE_FILE%"=="" (
  set "LIVE_FILE=%LIVE_FILE:"=%"
)
if not "%STAGE_FILE%"=="" (
  set "STAGE_FILE=%STAGE_FILE:"=%"
)

if "%LIVE_FILE%"=="" (
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "$dirs=@('%CRAWLER_OUTPUT_DIR%','%WEB_OUTPUT_DIR%'); $files=@(); foreach($d in $dirs){ if(Test-Path $d){ $files += Get-ChildItem $d -File -Filter '*data.json' | Where-Object { $_.Name -match 'live|crawler' } } }; $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "LIVE_FILE=%%F"
)

if "%STAGE_FILE%"=="" (
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "$dirs=@('%CRAWLER_OUTPUT_DIR%','%WEB_OUTPUT_DIR%'); $files=@(); foreach($d in $dirs){ if(Test-Path $d){ $files += Get-ChildItem $d -File -Filter '*data.json' | Where-Object { $_.Name -match 'stage|standings-targets|player-presentation' } } }; $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "STAGE_FILE=%%F"
)

if "%LIVE_FILE%"=="" (
  echo [ERROR] Live data JSON was not found automatically.
  echo Usage:
  echo   RUN_BRAND_COMPARE_LATEST.bat "LIVE_DATA_JSON" "STAGE_DATA_JSON"
  pause
  exit /b 1
)

if "%STAGE_FILE%"=="" (
  echo [WARN] Stage data JSON was not found automatically.
  echo Paste or drag the Stage data JSON path, then press Enter.
  set /p "STAGE_FILE=Stage JSON: "
  set "STAGE_FILE=!STAGE_FILE:"=!"
)

if not exist "%LIVE_FILE%" (
  echo [ERROR] Live file does not exist:
  echo   %LIVE_FILE%
  pause
  exit /b 1
)

if not exist "%STAGE_FILE%" (
  echo [ERROR] Stage file does not exist:
  echo   %STAGE_FILE%
  pause
  exit /b 1
)

echo ============================================
echo WSOP Brand Coverage Compare
echo ============================================
echo Live :
echo   %LIVE_FILE%
echo Stage:
echo   %STAGE_FILE%
echo.

cd /d "%WEB_AUTO_DIR%"

cmd.exe /d /s /c npm.cmd run crawl:brand-compare -- --live "%LIVE_FILE%" --stage "%STAGE_FILE%" --stage-default-brand WSOP
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Brand comparison completed.
  echo Output directory:
  echo   %WEB_OUTPUT_DIR%
) else (
  echo Brand comparison failed. Review the message above.
)

echo.
pause
exit /b %EXIT_CODE%
