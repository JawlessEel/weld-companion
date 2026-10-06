# Starts the Weld agent bridge hidden at every Windows login (no terminal window).
#   Install:    pwsh -File bridge\install-autostart.ps1
#   Remove:     pwsh -File bridge\install-autostart.ps1 -Remove
# It only adds one small launcher to your own Startup folder. Nothing needs admin rights.
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$bridge = Join-Path $PSScriptRoot 'weld-bridge.js'
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'Weld bridge.vbs'

if ($Remove) {
  if (Test-Path $launcher) { Remove-Item $launcher -Force; Write-Host 'Removed the Weld bridge autostart.' } else { Write-Host 'Autostart was not installed.' }
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed or not on PATH. Install it from https://nodejs.org and run this again.' }

# wscript runs the command with window style 0 (hidden). The bridge exits quietly if one is already running.
$vbs = 'CreateObject("WScript.Shell").Run """' + $node + '"" ""' + $bridge + '""", 0, False'
Set-Content -Path $launcher -Value $vbs -Encoding ASCII
Write-Host "Installed: $launcher"
Write-Host 'The bridge will start hidden at your next login. To start it now without logging out:'
Write-Host "  wscript.exe `"$launcher`""
Write-Host 'Then in Weld (Dev tab, Agent bridge) tick "Reconnect automatically" and press Connect once.'
