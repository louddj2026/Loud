param([string]$InstallRoot = $PSScriptRoot, [switch]$DetachData)
$ErrorActionPreference = 'Stop'
. (Join-Path $InstallRoot 'common.ps1')
$stateRoot = Get-LoudDataRoot
$pidFile = Join-Path $stateRoot 'server.json'
if (Test-Path -LiteralPath $pidFile) {
  $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)" -ErrorAction SilentlyContinue
  $expectedNode = Join-Path $InstallRoot 'runtime\node.exe'
  $expectedServer = Join-Path $InstallRoot 'app'
  if ($process -and $process.ExecutablePath -eq $expectedNode -and $process.CommandLine.Contains($expectedServer)) { Stop-Process -Id $saved.pid }
  Remove-Item -LiteralPath $pidFile -Force
}
if ($DetachData) {
  foreach ($relative in @('app\data', 'app\public\analysis')) {
    $link = Join-Path $InstallRoot $relative
    if (Test-Path -LiteralPath $link) {
      $item = Get-Item -LiteralPath $link -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($link, $false) }
    }
  }
}
