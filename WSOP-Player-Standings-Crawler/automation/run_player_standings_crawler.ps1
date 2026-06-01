param(
  [string]$PlayersUrl = "https://wsop-stage.ggnweb.com/players",
  [string[]]$PlayerUrl = @(),
  [int]$Limit = 10,
  [int]$ResultLimit = 0,
  [int]$ResultRankLimit = 0,
  [int]$MaxLoadMore = 100,
  [int]$ResultPageLimit = 0,
  [ValidateSet("skip", "fail", "check")]
  [string]$DisabledResultMode = "skip",
  [string]$OutputTag = "wsop-player-crawler",
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss"),
  [string]$BrowserChannel = "none",
  [string]$UserDataDir = "automation\.auth\wsop-player-crawler-chromium",
  [int]$AuthWaitMs = 0,
  [string]$Out = "",
  [string]$HtmlReport = "",
  [string]$DefectReport = "",
  [int]$Concurrency = 5,
  [string]$Brand = "",
  [string]$FromReport = "",
  [switch]$StandingsOnly,
  [switch]$ProfileOnly,
  [switch]$ResultOnly,
  [switch]$Headed,
  [switch]$Ui
)

$ErrorActionPreference = "Stop"

function Get-NodeSearchDirs {
  $dirs = @(
    "$env:ProgramFiles\nodejs",
    "${env:ProgramFiles(x86)}\nodejs",
    "$env:LOCALAPPDATA\Programs\nodejs"
  )

  return $dirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
}

function Resolve-CommandPath {
  param(
    [string[]]$Names
  )

  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  foreach ($nodeDir in Get-NodeSearchDirs) {
    foreach ($name in $Names) {
      $candidate = Join-Path $nodeDir $name
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  return $null
}

function Resolve-RequiredCommand {
  param(
    [string[]]$Names,
    [string]$InstallHint
  )

  $resolved = Resolve-CommandPath $Names
  if ($resolved) {
    return $resolved
  }

  Write-Host ""
  Write-Host "ERROR: $InstallHint"
  Write-Host ""
  Write-Host "Install option:"
  Write-Host "  winget install --id OpenJS.NodeJS.LTS --source winget"
  Write-Host ""
  Write-Host "After installation, close this window and run the crawler again."
  exit 1
}

function Add-NodeToPath {
  param(
    [string]$NodeCmd
  )

  $nodeDir = Split-Path -Parent $NodeCmd
  if ($nodeDir -and ($env:Path -notlike "*$nodeDir*")) {
    $env:Path = "$nodeDir;$env:Path"
  }
}

function Install-NodeWithWinget {
  $wingetCmd = Resolve-CommandPath @("winget.exe", "winget")
  if (-not $wingetCmd) {
    return $false
  }

  Write-Host "Node.js was not found. Trying to install Node.js LTS with winget..."
  & $wingetCmd install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "winget could not install Node.js automatically. Install Node.js LTS manually, then run this BAT again."
    return $false
  }

  foreach ($nodeDir in Get-NodeSearchDirs) {
    if (Test-Path $nodeDir) {
      $env:Path = "$nodeDir;$env:Path"
    }
  }

  return $true
}

function Ensure-NodeToolchain {
  $nodeCmd = Resolve-CommandPath @("node.exe", "node")
  if (-not $nodeCmd) {
    [void](Install-NodeWithWinget)
    $nodeCmd = Resolve-CommandPath @("node.exe", "node")
  }

  if (-not $nodeCmd) {
    Resolve-RequiredCommand @("node.exe", "node") "Node.js was not found. Install Node.js LTS, then run the crawler again."
  }

  Add-NodeToPath $nodeCmd

  $npmCmd = Resolve-CommandPath @("npm.cmd", "npm")
  if (-not $npmCmd) {
    Resolve-RequiredCommand @("npm.cmd", "npm") "npm was not found. Install Node.js LTS, then run the crawler again."
  }

  return @{
    Node = $nodeCmd
    Npm = $npmCmd
  }
}

function Invoke-ProjectDependencyInstall {
  param(
    [string]$NpmCmd
  )

  $playwrightCli = "node_modules\playwright\cli.js"
  if ((Test-Path "node_modules\playwright") -and (Test-Path $playwrightCli)) {
    return
  }

  Write-Host "Installing npm packages for this crawler..."
  if (Test-Path "package-lock.json") {
    & $NpmCmd ci
    if ($LASTEXITCODE -eq 0) {
      Write-Host ""
      return
    }

    Write-Host ""
    Write-Host "npm ci failed. Retrying with npm install..."
  }

  & $NpmCmd install
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "npm package installation failed. Check internet/proxy access, then run this BAT again."
    exit $LASTEXITCODE
  }
  Write-Host ""
}

function Install-PlaywrightChromium {
  param(
    [string]$NodeCmd
  )

  $playwrightCli = "node_modules\playwright\cli.js"
  if (-not (Test-Path $playwrightCli)) {
    Write-Host "Playwright package is missing after npm install."
    exit 1
  }

  Write-Host "Ensuring Playwright Chromium is installed..."
  & $NodeCmd $playwrightCli install chromium
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Playwright Chromium installation failed. Check internet/proxy access, then run this BAT again."
    exit $LASTEXITCODE
  }
  Write-Host ""
}

Push-Location (Join-Path $PSScriptRoot "..")
try {
  if ($Ui) {
    $env:PWDEBUG = "1"
    $Headed = $true
  }
  $safeOutputTag = ($OutputTag -replace '[^A-Za-z0-9._-]', '-').Trim('-')
  $safeRunId = ($RunId -replace '[^A-Za-z0-9._-]', '-').Trim('-')
  if (-not $safeOutputTag) {
    $safeOutputTag = "wsop-player-crawler"
  }
  if (-not $safeRunId) {
    $safeRunId = Get-Date -Format "yyyyMMdd-HHmmss"
  }

  if ([string]::IsNullOrWhiteSpace($Out)) {
    $Out = "automation\output\$safeOutputTag-$safeRunId-data.json"
  }
  if ([string]::IsNullOrWhiteSpace($HtmlReport)) {
    $HtmlReport = "automation\output\$safeOutputTag-$safeRunId-report.html"
  }
  if ([string]::IsNullOrWhiteSpace($DefectReport)) {
    $DefectReport = "automation\output\$safeOutputTag-$safeRunId-defects.csv"
  }

  Write-Host "Output JSON: $Out"
  Write-Host "HTML report: $HtmlReport"
  Write-Host "Defect CSV: $DefectReport"
  Write-Host ""

  foreach ($filePath in @($Out, $HtmlReport, $DefectReport)) {
    $parentPath = Split-Path -Parent $filePath
    if ($parentPath -and -not (Test-Path $parentPath)) {
      New-Item -ItemType Directory -Path $parentPath -Force | Out-Null
    }
  }

  $toolchain = Ensure-NodeToolchain
  $nodeCmd = $toolchain.Node
  $npmCmd = $toolchain.Npm

  Invoke-ProjectDependencyInstall $npmCmd

  if ($BrowserChannel -eq "none") {
    Install-PlaywrightChromium $nodeCmd
  }

  if ($Headed -and $AuthWaitMs -eq 0) {
    $AuthWaitMs = 300000
  }

  $scriptArgs = @(
    "automation\crawl_player_standings.mjs",
    "--players-url", $PlayersUrl,
    "--limit", $Limit,
    "--result-limit", $ResultLimit,
    "--result-rank-limit", $ResultRankLimit,
    "--max-load-more", $MaxLoadMore,
    "--result-page-limit", $ResultPageLimit,
    "--disabled-result-mode", $DisabledResultMode,
    "--browser-channel", $BrowserChannel,
    "--user-data-dir", $UserDataDir,
    "--auth-wait-ms", $AuthWaitMs,
    "--out", $Out,
    "--html", $HtmlReport,
    "--defects", $DefectReport,
    "--concurrency", $Concurrency
  )

  foreach ($url in $PlayerUrl) {
    $scriptArgs += @("--player-url", $url)
  }

  if ($Headed) {
    $scriptArgs += "--headed"
  }
  if ($StandingsOnly) {
    $scriptArgs += "--standings-only"
  }
  if ($ProfileOnly) {
    $scriptArgs += "--profile-only"
  }
  if ($ResultOnly) {
    $scriptArgs += "--result-only"
  }
  if ($FromReport) {
    $scriptArgs += @("--from-report", $FromReport)
  }
  if ($Brand) {
    $scriptArgs += @("--brand", $Brand)
  }

  & $nodeCmd @scriptArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
