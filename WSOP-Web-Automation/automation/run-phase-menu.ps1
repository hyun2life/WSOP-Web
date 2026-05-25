Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PhaseRegistryPath = Join-Path $ProjectRoot 'automation\phases.json'

Set-Location $ProjectRoot

if (-not (Test-Path -LiteralPath $PhaseRegistryPath)) {
  [System.Windows.Forms.MessageBox]::Show("Phase registry not found:`n$PhaseRegistryPath", 'WSOP Automation', 'OK', 'Error') | Out-Null
  exit 1
}

$PhaseConfig = Get-Content -LiteralPath $PhaseRegistryPath -Raw | ConvertFrom-Json
$Phases = @($PhaseConfig.phases)

function Set-ControlRoundCorners {
  param(
    [System.Windows.Forms.Control]$Control,
    [int]$Radius = 8
  )

  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $rect = New-Object System.Drawing.Rectangle(0, 0, $Control.Width, $Control.Height)
  $diameter = $Radius * 2

  $gp.StartFigure()
  $gp.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
  $gp.AddArc(($rect.Right - $diameter), $rect.Y, $diameter, $diameter, 270, 90)
  $gp.AddArc(($rect.Right - $diameter), ($rect.Bottom - $diameter), $diameter, $diameter, 0, 90)
  $gp.AddArc($rect.X, ($rect.Bottom - $diameter), $diameter, $diameter, 90, 90)
  $gp.CloseFigure()

  $Control.Region = New-Object System.Drawing.Region($gp)
  $gp.Dispose()
}

function Format-PhaseLabel {
  param($Phase)

  $status = if ($Phase.implemented) { 'ready' } else { 'planned' }
  return "$($Phase.id) - $($Phase.name) [$status]"
}

function Get-SelectedPhase {
  if ($phaseCombo.SelectedIndex -lt 0) {
    return $null
  }

  if ($phaseCombo.SelectedIndex -eq 0) {
    # Find all implemented phase IDs dynamically
    $implementedList = @()
    foreach ($p in $Phases) {
      if ($p.implemented) {
        $implementedList += $p.id
      }
    }
    $implStr = $implementedList -join ', '

    # Virtual phase object for 'all'
    return @{
      id = 'all'
      name = 'All Implemented Phases'
      reportSuite = 'all'
      testDir = 'All active test directories'
      description = "Runs all implemented test phases sequentially (currently $implStr)."
      implemented = $true
    }
  }

  return $Phases[$phaseCombo.SelectedIndex - 1]
}

function Append-Log {
  param([string]$Message)

  $logBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $Message`r`n")
}

function Start-CommandWindow {
  param(
    [string]$Title,
    [string]$Command,
    [string]$WindowStyle = 'Normal'
  )

  $envPrefix = ''
  if (-not [string]::IsNullOrWhiteSpace($env:BASE_URL)) {
    $envPrefix = "set BASE_URL=$($env:BASE_URL) && "
  }

  $fullCommand = "`"title $Title && cd /d `"$ProjectRoot`" && $envPrefix$Command`""
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $fullCommand) -WorkingDirectory $ProjectRoot -WindowStyle $WindowStyle | Out-Null
}

function Open-Report {
  param([string]$Mode)

  $phase = Get-SelectedPhase
  if ($null -eq $phase) {
    [System.Windows.Forms.MessageBox]::Show('Select a phase first.', 'WSOP Automation', 'OK', 'Warning') | Out-Null
    return
  }

  if ($phase.id -eq 'all') {
    [System.Windows.Forms.MessageBox]::Show('Please select a specific phase to open its report.', 'WSOP Automation', 'OK', 'Information') | Out-Null
    return
  }

  if (-not $phase.implemented) {
    [System.Windows.Forms.MessageBox]::Show("$($phase.id) is planned but not implemented yet.", 'WSOP Automation', 'OK', 'Information') | Out-Null
    return
  }

  if ($phase.id -eq 'crawler' -and $Mode -eq 'playwright') {
    [System.Windows.Forms.MessageBox]::Show("Crawler does not generate a Playwright Trace Report.`nPlease use 'KO Report' or 'EN Report' instead.", 'WSOP Automation', 'OK', 'Information') | Out-Null
    return
  }

  Append-Log "Opening latest $Mode report for $($phase.id)..."
  
  $args = @('/c', "node scripts\open-latest-smoke-report.cjs $($phase.reportSuite) $Mode")
  Start-Process -FilePath 'cmd.exe' -ArgumentList $args -WorkingDirectory $ProjectRoot -WindowStyle Hidden -CreateNoWindow | Out-Null
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'WSOP Web Automation Runner'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(780, 730)
$form.MinimumSize = New-Object System.Drawing.Size(796, 769)
$form.MaximumSize = New-Object System.Drawing.Size(796, 769)

# Color configurations
$ColorBg = [System.Drawing.Color]::FromArgb(26, 29, 36)       # #1A1D24
$ColorCard = [System.Drawing.Color]::FromArgb(34, 38, 48)     # #222630
$ColorInput = [System.Drawing.Color]::FromArgb(9, 13, 22)       # #090D16 (Deep terminal black)
$ColorHeader = [System.Drawing.Color]::FromArgb(17, 19, 24)   # #111318
$ColorBorder = [System.Drawing.Color]::FromArgb(55, 65, 81)   # #374151 (Border gray)

$ColorTextPrimary = [System.Drawing.Color]::FromArgb(229, 231, 235)  # #E5E7EB
$ColorTextMuted = [System.Drawing.Color]::FromArgb(156, 163, 175)     # #9CA3AF
$ColorTextAccent = [System.Drawing.Color]::FromArgb(99, 102, 241)     # #6366F1
$ColorTextSuccess = [System.Drawing.Color]::FromArgb(52, 211, 153)    # #34D399 (Bright Emerald)

# Button colors
$BtnRunBg = [System.Drawing.Color]::FromArgb(16, 185, 129)       # Emerald
$BtnRunHover = [System.Drawing.Color]::FromArgb(5, 150, 105)
$BtnReportBg = [System.Drawing.Color]::FromArgb(59, 130, 246)    # Blue
$BtnReportHover = [System.Drawing.Color]::FromArgb(37, 99, 235)
$BtnUtilBg = [System.Drawing.Color]::FromArgb(55, 65, 81)        # Gray
$BtnUtilHover = [System.Drawing.Color]::FromArgb(75, 85, 99)
$BtnCloseBg = [System.Drawing.Color]::FromArgb(239, 68, 68)       # Red
$BtnCloseHover = [System.Drawing.Color]::FromArgb(220, 38, 38)

# Fonts
$FontTitle = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$FontSubTitle = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Regular)
$FontLabel = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$FontControl = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$FontLog = New-Object System.Drawing.Font('Consolas', 10.5, [System.Drawing.FontStyle]::Regular)

$form.BackColor = $ColorBg
$form.ForeColor = $ColorTextPrimary
$form.Opacity = 0.0

# Fade-in animation
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15
$timer.Add_Tick({
  if ($form.Opacity -ge 1.0) {
    $timer.Stop()
    $timer.Dispose()
  } else {
    $form.Opacity += 0.08
  }
})

$form.Add_Shown({
  $timer.Start()
})

# 1. Header Panel
$headerPanel = New-Object System.Windows.Forms.Panel
$headerPanel.Size = New-Object System.Drawing.Size(780, 60)
$headerPanel.Location = New-Object System.Drawing.Point(0, 0)
$headerPanel.BackColor = $ColorHeader
$form.Controls.Add($headerPanel)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'WSOP Web Automation Runner'
$titleLabel.Font = $FontTitle
$titleLabel.ForeColor = $ColorTextAccent
$titleLabel.Location = New-Object System.Drawing.Point(18, 10)
$titleLabel.Size = New-Object System.Drawing.Size(350, 30)
$titleLabel.BackColor = [System.Drawing.Color]::Transparent
$headerPanel.Controls.Add($titleLabel)

$subTitleLabel = New-Object System.Windows.Forms.Label
$subTitleLabel.Text = 'Select a phase and run automated smoke or functional test suites.'
$subTitleLabel.Font = $FontSubTitle
$subTitleLabel.ForeColor = $ColorTextMuted
$subTitleLabel.Location = New-Object System.Drawing.Point(18, 38)
$subTitleLabel.Size = New-Object System.Drawing.Size(500, 18)
$subTitleLabel.BackColor = [System.Drawing.Color]::Transparent
$headerPanel.Controls.Add($subTitleLabel)

# 2. Left panel (Test Configurations Card)
$leftPanel = New-Object System.Windows.Forms.Panel
$leftPanel.Size = New-Object System.Drawing.Size(360, 420)
$leftPanel.Location = New-Object System.Drawing.Point(18, 75)
$leftPanel.BackColor = $ColorCard
$leftPanel.add_Paint({
  param($sender, $e)
  $pen = New-Object System.Drawing.Pen($ColorBorder, 1)
  $e.Graphics.DrawRectangle($pen, 0, 0, $sender.Width - 1, $sender.Height - 1)
  $pen.Dispose()
})
$form.Controls.Add($leftPanel)

$leftTitle = New-Object System.Windows.Forms.Label
$leftTitle.Text = 'Test Configurations'
$leftTitle.Font = $FontLabel
$leftTitle.ForeColor = $ColorTextPrimary
$leftTitle.Location = New-Object System.Drawing.Point(15, 12)
$leftTitle.Size = New-Object System.Drawing.Size(200, 20)
$leftPanel.Controls.Add($leftTitle)

$leftLine = New-Object System.Windows.Forms.Label
$leftLine.BackColor = $ColorBg
$leftLine.Location = New-Object System.Drawing.Point(15, 34)
$leftLine.Size = New-Object System.Drawing.Size(330, 2)
$leftPanel.Controls.Add($leftLine)

$phaseLabel = New-Object System.Windows.Forms.Label
$phaseLabel.Text = 'Target Phase'
$phaseLabel.Font = $FontLabel
$phaseLabel.ForeColor = $ColorTextMuted
$phaseLabel.Location = New-Object System.Drawing.Point(15, 50)
$phaseLabel.Size = New-Object System.Drawing.Size(150, 18)
$leftPanel.Controls.Add($phaseLabel)

$phaseCombo = New-Object System.Windows.Forms.ComboBox
$phaseCombo.DropDownStyle = 'DropDownList'
$phaseCombo.Font = $FontControl
$phaseCombo.BackColor = $ColorInput
$phaseCombo.ForeColor = $ColorTextPrimary
$phaseCombo.Location = New-Object System.Drawing.Point(15, 72)
$phaseCombo.Size = New-Object System.Drawing.Size(330, 25)
$phaseCombo.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
[void]$phaseCombo.Items.Add("all - Run all implemented phases")
foreach ($phase in $Phases) {
  [void]$phaseCombo.Items.Add((Format-PhaseLabel $phase))
}
$leftPanel.Controls.Add($phaseCombo)

# Target Environment
$envLabel = New-Object System.Windows.Forms.Label
$envLabel.Text = 'Target Environment'
$envLabel.Font = $FontLabel
$envLabel.ForeColor = $ColorTextMuted
$envLabel.Location = New-Object System.Drawing.Point(15, 110)
$envLabel.Size = New-Object System.Drawing.Size(150, 18)
$leftPanel.Controls.Add($envLabel)

$envCombo = New-Object System.Windows.Forms.ComboBox
$envCombo.DropDownStyle = 'DropDownList'
$envCombo.Font = $FontControl
$envCombo.BackColor = $ColorInput
$envCombo.ForeColor = $ColorTextPrimary
$envCombo.Location = New-Object System.Drawing.Point(15, 132)
$envCombo.Size = New-Object System.Drawing.Size(330, 25)
$envCombo.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
[void]$envCombo.Items.Add('Live (https://www.wsop.com)')
[void]$envCombo.Items.Add('Stage (https://wsop-stage.ggnweb.com)')
[void]$envCombo.Items.Add('Custom URL...')
$envCombo.SelectedIndex = 0
$leftPanel.Controls.Add($envCombo)

$envInput = New-Object System.Windows.Forms.TextBox
$envInput.Text = 'https://'
$envInput.Font = $FontControl
$envInput.BackColor = $ColorInput
$envInput.ForeColor = $ColorTextPrimary
$envInput.Location = New-Object System.Drawing.Point(15, 170)
$envInput.Size = New-Object System.Drawing.Size(330, 20)
$envInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$envInput.Enabled = $false
$leftPanel.Controls.Add($envInput)

$envCombo.Add_SelectedIndexChanged({
  $envInput.Enabled = ($envCombo.SelectedIndex -eq 2)
})

# Execution Mode
$modeLabel = New-Object System.Windows.Forms.Label
$modeLabel.Text = 'Execution Mode'
$modeLabel.Font = $FontLabel
$modeLabel.ForeColor = $ColorTextMuted
$modeLabel.Location = New-Object System.Drawing.Point(15, 210)
$modeLabel.Size = New-Object System.Drawing.Size(150, 18)
$leftPanel.Controls.Add($modeLabel)

$modeCombo = New-Object System.Windows.Forms.ComboBox
$modeCombo.DropDownStyle = 'DropDownList'
$modeCombo.Font = $FontControl
$modeCombo.BackColor = $ColorInput
$modeCombo.ForeColor = $ColorTextPrimary
$modeCombo.Location = New-Object System.Drawing.Point(15, 232)
$modeCombo.Size = New-Object System.Drawing.Size(330, 25)
$modeCombo.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
[void]$modeCombo.Items.Add('Normal')
[void]$modeCombo.Items.Add('Headed')
[void]$modeCombo.Items.Add('UI')
$modeCombo.SelectedIndex = 0
$leftPanel.Controls.Add($modeCombo)

$argsPanel = New-Object System.Windows.Forms.Panel
$argsPanel.Location = New-Object System.Drawing.Point(15, 270)
$argsPanel.Size = New-Object System.Drawing.Size(330, 125)
$argsPanel.BackColor = $ColorCard

$argsTitle = New-Object System.Windows.Forms.Label
$argsTitle.Text = 'Crawler Options (Overridable)'
$argsTitle.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$argsTitle.ForeColor = $ColorTextMuted
$argsTitle.Location = New-Object System.Drawing.Point(0, 0)
$argsTitle.Size = New-Object System.Drawing.Size(330, 15)
$argsPanel.Controls.Add($argsTitle)

$argsLine = New-Object System.Windows.Forms.Label
$argsLine.BackColor = $ColorBg
$argsLine.Location = New-Object System.Drawing.Point(0, 18)
$argsLine.Size = New-Object System.Drawing.Size(330, 1)
$argsPanel.Controls.Add($argsLine)

$limitCheck = New-Object System.Windows.Forms.CheckBox
$limitCheck.Text = 'Limit Players'
$limitCheck.Font = $FontControl
$limitCheck.ForeColor = $ColorTextPrimary
$limitCheck.Location = New-Object System.Drawing.Point(0, 25)
$limitCheck.Size = New-Object System.Drawing.Size(180, 20)
$limitCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$argsPanel.Controls.Add($limitCheck)

$limitInput = New-Object System.Windows.Forms.TextBox
$limitInput.Text = '10'
$limitInput.Font = $FontControl
$limitInput.BackColor = $ColorInput
$limitInput.ForeColor = $ColorTextPrimary
$limitInput.Location = New-Object System.Drawing.Point(185, 23)
$limitInput.Size = New-Object System.Drawing.Size(145, 20)
$limitInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$limitInput.Enabled = $false
$argsPanel.Controls.Add($limitInput)

$authCheck = New-Object System.Windows.Forms.CheckBox
$authCheck.Text = 'Auth Wait (ms)'
$authCheck.Font = $FontControl
$authCheck.ForeColor = $ColorTextPrimary
$authCheck.Location = New-Object System.Drawing.Point(0, 50)
$authCheck.Size = New-Object System.Drawing.Size(180, 20)
$authCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$argsPanel.Controls.Add($authCheck)

$authInput = New-Object System.Windows.Forms.TextBox
$authInput.Text = '300000'
$authInput.Font = $FontControl
$authInput.BackColor = $ColorInput
$authInput.ForeColor = $ColorTextPrimary
$authInput.Location = New-Object System.Drawing.Point(185, 48)
$authInput.Size = New-Object System.Drawing.Size(145, 20)
$authInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$authInput.Enabled = $false
$argsPanel.Controls.Add($authInput)

$concurrencyCheck = New-Object System.Windows.Forms.CheckBox
$concurrencyCheck.Text = 'Concurrency'
$concurrencyCheck.Font = $FontControl
$concurrencyCheck.ForeColor = $ColorTextPrimary
$concurrencyCheck.Location = New-Object System.Drawing.Point(0, 75)
$concurrencyCheck.Size = New-Object System.Drawing.Size(180, 20)
$concurrencyCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$argsPanel.Controls.Add($concurrencyCheck)

$concurrencyInput = New-Object System.Windows.Forms.TextBox
$concurrencyInput.Text = '10'
$concurrencyInput.Font = $FontControl
$concurrencyInput.BackColor = $ColorInput
$concurrencyInput.ForeColor = $ColorTextPrimary
$concurrencyInput.Location = New-Object System.Drawing.Point(185, 73)
$concurrencyInput.Size = New-Object System.Drawing.Size(145, 20)
$concurrencyInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$concurrencyInput.Enabled = $false
$argsPanel.Controls.Add($concurrencyInput)

$resLimitCheck = New-Object System.Windows.Forms.CheckBox
$resLimitCheck.Text = 'Result Limit'
$resLimitCheck.Font = $FontControl
$resLimitCheck.ForeColor = $ColorTextPrimary
$resLimitCheck.Location = New-Object System.Drawing.Point(0, 100)
$resLimitCheck.Size = New-Object System.Drawing.Size(180, 20)
$resLimitCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$argsPanel.Controls.Add($resLimitCheck)

$resLimitInput = New-Object System.Windows.Forms.TextBox
$resLimitInput.Text = '0'
$resLimitInput.Font = $FontControl
$resLimitInput.BackColor = $ColorInput
$resLimitInput.ForeColor = $ColorTextPrimary
$resLimitInput.Location = New-Object System.Drawing.Point(185, 98)
$resLimitInput.Size = New-Object System.Drawing.Size(145, 20)
$resLimitInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$resLimitInput.Enabled = $false
$argsPanel.Controls.Add($resLimitInput)

$limitCheck.Add_CheckedChanged({ $limitInput.Enabled = $limitCheck.Checked })
$authCheck.Add_CheckedChanged({ $authInput.Enabled = $authCheck.Checked })
$concurrencyCheck.Add_CheckedChanged({ $concurrencyInput.Enabled = $concurrencyCheck.Checked })
$resLimitCheck.Add_CheckedChanged({ $resLimitInput.Enabled = $resLimitCheck.Checked })

$leftPanel.Controls.Add($argsPanel)

$pwArgsPanel = New-Object System.Windows.Forms.Panel
$pwArgsPanel.Location = New-Object System.Drawing.Point(15, 270)
$pwArgsPanel.Size = New-Object System.Drawing.Size(330, 125)
$pwArgsPanel.BackColor = $ColorCard
$pwArgsPanel.Visible = $false

$pwArgsTitle = New-Object System.Windows.Forms.Label
$pwArgsTitle.Text = 'Playwright Options (Overridable)'
$pwArgsTitle.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$pwArgsTitle.ForeColor = $ColorTextMuted
$pwArgsTitle.Location = New-Object System.Drawing.Point(0, 0)
$pwArgsTitle.Size = New-Object System.Drawing.Size(330, 15)
$pwArgsPanel.Controls.Add($pwArgsTitle)

$pwArgsLine = New-Object System.Windows.Forms.Label
$pwArgsLine.BackColor = $ColorBg
$pwArgsLine.Location = New-Object System.Drawing.Point(0, 18)
$pwArgsLine.Size = New-Object System.Drawing.Size(330, 1)
$pwArgsPanel.Controls.Add($pwArgsLine)

$grepCheck = New-Object System.Windows.Forms.CheckBox
$grepCheck.Text = 'Grep Filter'
$grepCheck.Font = $FontControl
$grepCheck.ForeColor = $ColorTextPrimary
$grepCheck.Location = New-Object System.Drawing.Point(0, 25)
$grepCheck.Size = New-Object System.Drawing.Size(180, 20)
$grepCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$pwArgsPanel.Controls.Add($grepCheck)

$grepInput = New-Object System.Windows.Forms.TextBox
$grepInput.Text = 'schedule'
$grepInput.Font = $FontControl
$grepInput.BackColor = $ColorInput
$grepInput.ForeColor = $ColorTextPrimary
$grepInput.Location = New-Object System.Drawing.Point(185, 23)
$grepInput.Size = New-Object System.Drawing.Size(145, 20)
$grepInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$grepInput.Enabled = $false
$pwArgsPanel.Controls.Add($grepInput)

$timeoutCheck = New-Object System.Windows.Forms.CheckBox
$timeoutCheck.Text = 'Timeout (ms)'
$timeoutCheck.Font = $FontControl
$timeoutCheck.ForeColor = $ColorTextPrimary
$timeoutCheck.Location = New-Object System.Drawing.Point(0, 50)
$timeoutCheck.Size = New-Object System.Drawing.Size(180, 20)
$timeoutCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$pwArgsPanel.Controls.Add($timeoutCheck)

$timeoutInput = New-Object System.Windows.Forms.TextBox
$timeoutInput.Text = '30000'
$timeoutInput.Font = $FontControl
$timeoutInput.BackColor = $ColorInput
$timeoutInput.ForeColor = $ColorTextPrimary
$timeoutInput.Location = New-Object System.Drawing.Point(185, 48)
$timeoutInput.Size = New-Object System.Drawing.Size(145, 20)
$timeoutInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$timeoutInput.Enabled = $false
$pwArgsPanel.Controls.Add($timeoutInput)

$repeatCheck = New-Object System.Windows.Forms.CheckBox
$repeatCheck.Text = 'Repeat Each'
$repeatCheck.Font = $FontControl
$repeatCheck.ForeColor = $ColorTextPrimary
$repeatCheck.Location = New-Object System.Drawing.Point(0, 75)
$repeatCheck.Size = New-Object System.Drawing.Size(180, 20)
$repeatCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$pwArgsPanel.Controls.Add($repeatCheck)

$repeatInput = New-Object System.Windows.Forms.TextBox
$repeatInput.Text = '1'
$repeatInput.Font = $FontControl
$repeatInput.BackColor = $ColorInput
$repeatInput.ForeColor = $ColorTextPrimary
$repeatInput.Location = New-Object System.Drawing.Point(185, 73)
$repeatInput.Size = New-Object System.Drawing.Size(145, 20)
$repeatInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$repeatInput.Enabled = $false
$pwArgsPanel.Controls.Add($repeatInput)

$retriesCheck = New-Object System.Windows.Forms.CheckBox
$retriesCheck.Text = 'Retries Limit'
$retriesCheck.Font = $FontControl
$retriesCheck.ForeColor = $ColorTextPrimary
$retriesCheck.Location = New-Object System.Drawing.Point(0, 100)
$retriesCheck.Size = New-Object System.Drawing.Size(180, 20)
$retriesCheck.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$pwArgsPanel.Controls.Add($retriesCheck)

$retriesInput = New-Object System.Windows.Forms.TextBox
$retriesInput.Text = '0'
$retriesInput.Font = $FontControl
$retriesInput.BackColor = $ColorInput
$retriesInput.ForeColor = $ColorTextPrimary
$retriesInput.Location = New-Object System.Drawing.Point(185, 98)
$retriesInput.Size = New-Object System.Drawing.Size(145, 20)
$retriesInput.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$retriesInput.Enabled = $false
$pwArgsPanel.Controls.Add($retriesInput)

$grepCheck.Add_CheckedChanged({ $grepInput.Enabled = $grepCheck.Checked })
$timeoutCheck.Add_CheckedChanged({ $timeoutInput.Enabled = $timeoutCheck.Checked })
$repeatCheck.Add_CheckedChanged({ $repeatInput.Enabled = $repeatCheck.Checked })
$retriesCheck.Add_CheckedChanged({ $retriesInput.Enabled = $retriesCheck.Checked })

$leftPanel.Controls.Add($pwArgsPanel)

$toolTip = New-Object System.Windows.Forms.ToolTip
$toolTip.InitialDelay = 500
$toolTip.ReshowDelay = 100
$toolTip.SetToolTip($argsPanel, "Check parameters and input custom values for crawler automation")
$toolTip.SetToolTip($pwArgsPanel, "Check parameters and input custom values for Playwright tests")

$runButton = New-Object System.Windows.Forms.Button
$runButton.Text = 'Run Selected Test'
$runButton.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$runButton.BackColor = $BtnRunBg
$runButton.ForeColor = [System.Drawing.Color]::White
$runButton.Location = New-Object System.Drawing.Point(15, 365)
$runButton.Size = New-Object System.Drawing.Size(330, 45)
$runButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$runButton.FlatAppearance.BorderSize = 0
$runButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$runButton.FlatAppearance.MouseOverBackColor = $BtnRunHover
Set-ControlRoundCorners $runButton 8
$leftPanel.Controls.Add($runButton)

# 3. Right panel (Details & Utilities Card)
$rightPanel = New-Object System.Windows.Forms.Panel
$rightPanel.Size = New-Object System.Drawing.Size(360, 420)
$rightPanel.Location = New-Object System.Drawing.Point(402, 75)
$rightPanel.BackColor = $ColorCard
$rightPanel.add_Paint({
  param($sender, $e)
  $pen = New-Object System.Drawing.Pen($ColorBorder, 1)
  $e.Graphics.DrawRectangle($pen, 0, 0, $sender.Width - 1, $sender.Height - 1)
  $pen.Dispose()
})
$form.Controls.Add($rightPanel)

$rightTitle = New-Object System.Windows.Forms.Label
$rightTitle.Text = 'Phase Details & Utilities'
$rightTitle.Font = $FontLabel
$rightTitle.ForeColor = $ColorTextPrimary
$rightTitle.Location = New-Object System.Drawing.Point(15, 12)
$rightTitle.Size = New-Object System.Drawing.Size(200, 20)
$rightPanel.Controls.Add($rightTitle)

$rightLine = New-Object System.Windows.Forms.Label
$rightLine.BackColor = $ColorBg
$rightLine.Location = New-Object System.Drawing.Point(15, 34)
$rightLine.Size = New-Object System.Drawing.Size(330, 2)
$rightPanel.Controls.Add($rightLine)

$descriptionBox = New-Object System.Windows.Forms.TextBox
$descriptionBox.Location = New-Object System.Drawing.Point(15, 45)
$descriptionBox.Size = New-Object System.Drawing.Size(330, 195)
$descriptionBox.Multiline = $true
$descriptionBox.ReadOnly = $true
$descriptionBox.BackColor = $ColorInput
$descriptionBox.ForeColor = $ColorTextPrimary
$descriptionBox.Font = $FontSubTitle
$descriptionBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$descriptionBox.ScrollBars = 'Vertical'
$rightPanel.Controls.Add($descriptionBox)

$reportKoButton = New-Object System.Windows.Forms.Button
$reportKoButton.Text = 'KO Report'
$reportKoButton.Font = $FontControl
$reportKoButton.BackColor = $BtnReportBg
$reportKoButton.ForeColor = [System.Drawing.Color]::White
$reportKoButton.Location = New-Object System.Drawing.Point(15, 265)
$reportKoButton.Size = New-Object System.Drawing.Size(104, 36)
$reportKoButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$reportKoButton.FlatAppearance.BorderSize = 0
$reportKoButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$reportKoButton.FlatAppearance.MouseOverBackColor = $BtnReportHover
Set-ControlRoundCorners $reportKoButton 6
$rightPanel.Controls.Add($reportKoButton)

$reportEnButton = New-Object System.Windows.Forms.Button
$reportEnButton.Text = 'EN Report'
$reportEnButton.Font = $FontControl
$reportEnButton.BackColor = $BtnReportBg
$reportEnButton.ForeColor = [System.Drawing.Color]::White
$reportEnButton.Location = New-Object System.Drawing.Point(125, 265)
$reportEnButton.Size = New-Object System.Drawing.Size(104, 36)
$reportEnButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$reportEnButton.FlatAppearance.BorderSize = 0
$reportEnButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$reportEnButton.FlatAppearance.MouseOverBackColor = $BtnReportHover
Set-ControlRoundCorners $reportEnButton 6
$rightPanel.Controls.Add($reportEnButton)

$reportPwButton = New-Object System.Windows.Forms.Button
$reportPwButton.Text = 'PW Report'
$reportPwButton.Font = $FontControl
$reportPwButton.BackColor = $BtnReportBg
$reportPwButton.ForeColor = [System.Drawing.Color]::White
$reportPwButton.Location = New-Object System.Drawing.Point(235, 265)
$reportPwButton.Size = New-Object System.Drawing.Size(110, 36)
$reportPwButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$reportPwButton.FlatAppearance.BorderSize = 0
$reportPwButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$reportPwButton.FlatAppearance.MouseOverBackColor = $BtnReportHover
Set-ControlRoundCorners $reportPwButton 6
$rightPanel.Controls.Add($reportPwButton)

$listButton = New-Object System.Windows.Forms.Button
$listButton.Text = 'Phase List'
$listButton.Font = $FontControl
$listButton.BackColor = $BtnUtilBg
$listButton.ForeColor = [System.Drawing.Color]::White
$listButton.Location = New-Object System.Drawing.Point(15, 365)
$listButton.Size = New-Object System.Drawing.Size(160, 45)
$listButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$listButton.FlatAppearance.BorderSize = 0
$listButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$listButton.FlatAppearance.MouseOverBackColor = $BtnUtilHover
Set-ControlRoundCorners $listButton 8
$rightPanel.Controls.Add($listButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = 'Close Menu'
$closeButton.Font = $FontControl
$closeButton.BackColor = $BtnCloseBg
$closeButton.ForeColor = [System.Drawing.Color]::White
$closeButton.Location = New-Object System.Drawing.Point(185, 365)
$closeButton.Size = New-Object System.Drawing.Size(160, 45)
$closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeButton.FlatAppearance.BorderSize = 0
$closeButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$closeButton.FlatAppearance.MouseOverBackColor = $BtnCloseHover
Set-ControlRoundCorners $closeButton 8
$rightPanel.Controls.Add($closeButton)

# 4. Bottom panel (Console Log Output Card)
$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Size = New-Object System.Drawing.Size(744, 202)
$logPanel.Location = New-Object System.Drawing.Point(18, 510)
$logPanel.BackColor = $ColorCard
$logPanel.add_Paint({
  param($sender, $e)
  $pen = New-Object System.Drawing.Pen($ColorBorder, 1)
  $e.Graphics.DrawRectangle($pen, 0, 0, $sender.Width - 1, $sender.Height - 1)
  $pen.Dispose()
})
$form.Controls.Add($logPanel)

$logTitle = New-Object System.Windows.Forms.Label
$logTitle.Text = 'Console Log Output'
$logTitle.Font = $FontLabel
$logTitle.ForeColor = $ColorTextPrimary
$logTitle.Location = New-Object System.Drawing.Point(15, 10)
$logTitle.Size = New-Object System.Drawing.Size(200, 18)
$logPanel.Controls.Add($logTitle)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(15, 32)
$logBox.Size = New-Object System.Drawing.Size(714, 155)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BackColor = $ColorInput
$logBox.ForeColor = $ColorTextSuccess
$logBox.Font = $FontLog
$logBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$logPanel.Controls.Add($logBox)

# Event handler bindings
$phaseCombo.Add_SelectedIndexChanged({
  $phase = Get-SelectedPhase
  if ($null -eq $phase) {
    $descriptionBox.Text = ''
    return
  }

  $extraGuide = ''
  if ($phase.id -eq 'crawler') {
    $argsPanel.Visible = $true
    $pwArgsPanel.Visible = $false

    $extraGuide = "`r`n`r`n[크롤러 옵션 설명 가이드]`r`n" +
                  "▶ Limit Players (플레이어 제한)`r`n" +
                  "   - 카테고리당 수집할 최대 플레이어 수 (기본: 10)`r`n" +
                  "▶ Auth Wait (ms) (로그인 대기시간)`r`n" +
                  "   - Cloudflare 로그인 대기를 위한 밀리초 (기본: 300000 = 5분)`r`n" +
                  "▶ Concurrency (동시 실행 수)`r`n" +
                  "   - 스크랩 수행을 동시에 실행할 브라우저 스레드 수 (기본: 10)`r`n" +
                  "▶ Result Limit (결과 검사 제한)`r`n" +
                  "   - 플레이어 프로필당 검사할 최대 결과 페이지 수 (기본: 0 - 전체)"
  } elseif ($phase.id -eq 'all') {
    $argsPanel.Visible = $false
    $pwArgsPanel.Visible = $false
  } else {
    $argsPanel.Visible = $false
    $pwArgsPanel.Visible = $true

    $extraGuide = "`r`n`r`n[Playwright 추가 인자 가이드]`r`n" +
                  "▶ --grep <패턴>`r`n" +
                  "   - 특정 제목의 테스트만 필터링하여 실행 (예: --grep 'schedule')`r`n" +
                  "▶ --project <프로젝트>`r`n" +
                  "   - 실행할 브라우저 설정 (chromium-desktop / mobile-safari)`r`n" +
                  "▶ --timeout <밀리초>`r`n" +
                  "   - 개별 테스트 타임아웃 제한 시간 설정 (ms)`r`n" +
                  "▶ --repeat-each <횟수>`r`n" +
                  "   - 안정성 확인을 위해 동일 테스트를 N회 반복 실행"
  }

  $descriptionBox.Text = "Report suite: $($phase.reportSuite)`r`nTest folder: $($phase.testDir)`r`n$($phase.description)$extraGuide"
})

$runButton.Add_Click({
  $phase = Get-SelectedPhase
  if ($null -eq $phase) {
    [System.Windows.Forms.MessageBox]::Show('Select a phase first.', 'WSOP Automation', 'OK', 'Warning') | Out-Null
    return
  }

  $baseUrl = ''
  if ($envCombo.SelectedIndex -eq 0) {
    $baseUrl = 'https://www.wsop.com'
  } elseif ($envCombo.SelectedIndex -eq 1) {
    $baseUrl = 'https://wsop-stage.ggnweb.com'
  } elseif ($envCombo.SelectedIndex -eq 2) {
    $baseUrl = $envInput.Text.Trim()
  }

  if ($baseUrl -ne '') {
    $env:BASE_URL = $baseUrl
  } else {
    Remove-Item env:BASE_URL -ErrorAction SilentlyContinue
  }

  if (-not $phase.implemented) {
    [System.Windows.Forms.MessageBox]::Show("$($phase.id) is registered but not implemented yet.`nTarget folder: $($phase.testDir)", 'WSOP Automation', 'OK', 'Information') | Out-Null
    return
  }

  $selectedMode = [string]$modeCombo.SelectedItem
  $extraArgs = ''
  $winStyle = 'Normal'
  if ($selectedMode -eq 'Headed') {
    $extraArgs = ' -- --headed'
  } elseif ($selectedMode -eq 'UI') {
    $extraArgs = ' -- --ui'
  } else {
    $winStyle = 'Minimized'
  }

  $customArgsStr = ''
  if ($phase.id -eq 'crawler') {
    $customArgs = @()
    if ($limitCheck.Checked) {
      $customArgs += "--limit $($limitInput.Text.Trim())"
    }
    if ($authCheck.Checked) {
      $customArgs += "--auth-wait-ms $($authInput.Text.Trim())"
    }
    if ($concurrencyCheck.Checked) {
      $customArgs += "--concurrency $($concurrencyInput.Text.Trim())"
    }
    if ($resLimitCheck.Checked) {
      $customArgs += "--result-limit $($resLimitInput.Text.Trim())"
    }
    $customArgsStr = $customArgs -join ' '
  } else {
    $customArgs = @()
    if ($grepCheck.Checked) {
      $customArgs += "--grep `"$($grepInput.Text.Trim())`""
    }
    if ($timeoutCheck.Checked) {
      $customArgs += "--timeout $($timeoutInput.Text.Trim())"
    }
    if ($repeatCheck.Checked) {
      $customArgs += "--repeat-each $($repeatInput.Text.Trim())"
    }
    if ($retriesCheck.Checked) {
      $customArgs += "--retries $($retriesInput.Text.Trim())"
    }
    $customArgsStr = $customArgs -join ' '
  }

  if ($customArgsStr -ne '') {
    if ($extraArgs -eq '') {
      $extraArgs = " -- $customArgsStr"
    } else {
      $extraArgs = "$extraArgs $customArgsStr"
    }
  }

  $command = "node scripts\run-phase.cjs $($phase.id)$extraArgs"
  Append-Log "Running $($phase.id): $($phase.name) / mode: $selectedMode"
  Append-Log $command
  Start-CommandWindow "WSOP $($phase.id)" $command $winStyle
})

$listButton.Add_Click({
  Append-Log 'Opening phase list...'
  Start-CommandWindow 'WSOP phase list' 'node scripts\run-phase.cjs list'
})

$reportKoButton.Add_Click({ Open-Report 'ko' })
$reportEnButton.Add_Click({ Open-Report 'en' })
$reportPwButton.Add_Click({ Open-Report 'playwright' })
$closeButton.Add_Click({ $form.Close() })

if ($phaseCombo.Items.Count -gt 0) {
  $phaseCombo.SelectedIndex = 0
}

Append-Log 'Select a phase, then click Run Selected.'

[void]$form.ShowDialog()
