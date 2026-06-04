@echo off
setlocal

cd /d "%~dp0"

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if not exist "automation\output" mkdir "automation\output"

rem -------------------------------------------------------------
rem Tournament Crawler Configuration
rem -------------------------------------------------------------
rem YEAR: Target year for past tournaments. Default is 2026.
rem BRAND: Filter by brand (e.g. CIRCUIT, BRACELETS). Empty means no filter.
rem LIMIT: Maximum number of tournaments to process. Default is 10.
rem CONCURRENCY: Maximum parallel tournament crawls. Default is 3.
rem HEADED: Run with browser window visible (true) or background (false).
rem WSOP_NO_PAUSE: Set to true to skip pausing at the end (for CI/CD).
rem -------------------------------------------------------------
if "%YEAR%"=="" set "YEAR=2026"
if "%BRAND%"=="" set "BRAND="
if "%LIMIT%"=="" (
  if not "%PLAYER_LIMIT%"=="" (
    set "LIMIT=%PLAYER_LIMIT%"
  ) else (
    set "LIMIT=1000"
  )
)
if "%CONCURRENCY%"=="" set "CONCURRENCY=10"
if "%HEADED%"=="" set "HEADED=true"
if "%WSOP_NO_PAUSE%"=="" set "WSOP_NO_PAUSE=false"

set "HEADED_FLAG="
if "%HEADED%"=="true" set "HEADED_FLAG=--headed"

set "BRAND_FLAG="
if not "%BRAND%"=="" set "BRAND_FLAG=--brand "%BRAND%""

echo ==============================================
echo WSOP Past Tournaments Crawler
echo ==============================================
echo.
echo Settings:
echo   YEAR        : "%YEAR%"
echo   BRAND FILTER: %BRAND% (Empty = All)
echo   LIMIT       : %LIMIT%
echo   CONCURRENCY : %CONCURRENCY%
echo   HEADED      : %HEADED%
echo.
echo Executing crawler...
echo.

node automation\crawl_tournaments.mjs --year "%YEAR%" --limit %LIMIT% --concurrency %CONCURRENCY% %HEADED_FLAG% %BRAND_FLAG%
set EXIT_CODE=%ERRORLEVEL%

echo.
rem Find the latest generated HTML report that fits the run pattern
for /f "delims=" %%F in ('dir /b /o-d "automation\output\wsop-tournament-crawler-%YEAR%*.html" 2^>nul') do (
  set "LATEST_REPORT=automation\output\%%F"
  goto :found_report
)
:found_report

if not "%LATEST_REPORT%"=="" (
  echo Opening latest generated report: %LATEST_REPORT%
  start "" "%LATEST_REPORT%"
) else (
  echo No specific report found. Opening output folder.
  start "" "automation\output"
)

echo.
if "%EXIT_CODE%"=="0" (
  echo Crawl completed successfully.
) else (
  echo Crawl encountered errors or exited with code %EXIT_CODE%.
)

echo.
if not "%WSOP_NO_PAUSE%"=="true" pause
exit /b %EXIT_CODE%
