@echo off
setlocal

cd /d "%~dp0"

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if not exist "automation\output" mkdir "automation\output"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "RUN_ID=%%I"
set "REPORT=automation\output\wsop-player-crawler-live-%RUN_ID%-report.html"
set "KOREAN_REPORT=automation\output\wsop-player-crawler-live-%RUN_ID%-report-ko.html"

rem Live QA controls. Lower these values only for quick smoke tests.
rem PLAYER_LIMIT: players per standings category.
rem RESULT_LIMIT: Result pages per player. 0 checks every Result.
rem RESULT_RANK_LIMIT: skip Result checks when rank is above this. 0 means no rank cap.
rem MAX_LOAD_MORE: profile ALL-tab Load more clicks.
rem RESULT_PAGE_LIMIT: Final Result pages to inspect per Result. 0 checks every page.
rem DISABLED_RESULT_MODE: skip, fail, or check disabled Result controls.
if "%PLAYER_LIMIT%"=="" set "PLAYER_LIMIT=10"
if "%RESULT_LIMIT%"=="" set "RESULT_LIMIT=0"
if "%RESULT_RANK_LIMIT%"=="" set "RESULT_RANK_LIMIT=0"
if "%MAX_LOAD_MORE%"=="" set "MAX_LOAD_MORE=100"
if "%RESULT_PAGE_LIMIT%"=="" set "RESULT_PAGE_LIMIT=0"
if "%DISABLED_RESULT_MODE%"=="" set "DISABLED_RESULT_MODE=skip"
if "%CONCURRENCY%"=="" set "CONCURRENCY=10"
if "%AUTH_WAIT_MS%"=="" set "AUTH_WAIT_MS=300000"
rem WSOP_NO_PAUSE: true to skip pausing at the end (for automation runners)
if "%WSOP_NO_PAUSE%"=="" set "WSOP_NO_PAUSE=false"

echo ============================================
echo WSOP LIVE Player Standings Crawler (Improved)
echo ============================================
echo.
echo Target:
echo   https://www.wsop.com/player-standings/
echo.
echo First run may install Node.js, npm packages, and Playwright Chromium.
echo A browser will open. Keep it open until the report is generated.
echo.

set "CRAWLER_SCRIPT=automation\run_player_standings_crawler.ps1"
if not "%BASE_URL%"=="" (
  set "PLAYERS_URL=%BASE_URL%/player-standings/"
) else (
  set "PLAYERS_URL=https://www.wsop.com/player-standings/"
)
set "OUTPUT_TAG=wsop-player-crawler-live"

if "%HEADED%"=="" set "HEADED=true"
if "%HEADED%"=="true" (set "HEADED_FLAG=-Headed") else (set "HEADED_FLAG=")

if "%UI%"=="true" (set "UI_FLAG=-Ui") else (set "UI_FLAG=")

if "%STANDINGS_ONLY%"=="true" (set "STANDINGS_ONLY_FLAG=-StandingsOnly") else (set "STANDINGS_ONLY_FLAG=")
if not "%BRAND%"=="" (set "BRAND_PARAM=-Brand "%BRAND%"") else (set "BRAND_PARAM=")

powershell -NoProfile -ExecutionPolicy Bypass -File "%CRAWLER_SCRIPT%" -PlayersUrl "%PLAYERS_URL%" -OutputTag "%OUTPUT_TAG%" -RunId "%RUN_ID%" %HEADED_FLAG% %UI_FLAG% %STANDINGS_ONLY_FLAG% %BRAND_PARAM% -AuthWaitMs %AUTH_WAIT_MS% -Limit %PLAYER_LIMIT% -ResultLimit %RESULT_LIMIT% -ResultRankLimit %RESULT_RANK_LIMIT% -MaxLoadMore %MAX_LOAD_MORE% -ResultPageLimit %RESULT_PAGE_LIMIT% -DisabledResultMode "%DISABLED_RESULT_MODE%" -Concurrency %CONCURRENCY%
set EXIT_CODE=%ERRORLEVEL%

echo.
if exist "%KOREAN_REPORT%" (
  echo Opening generated Korean live crawler report.
  start "" "%KOREAN_REPORT%"
) else if exist "%REPORT%" (
  echo Opening generated live crawler report.
  start "" "%REPORT%"
) else (
  start "" "automation\output"
)

echo.
if "%EXIT_CODE%"=="0" (
  echo Live crawl completed.
) else (
  echo Live crawl found failures or could not complete. Review the report and message above.
)

echo.
if not "%WSOP_NO_PAUSE%"=="true" pause
exit /b %EXIT_CODE%
