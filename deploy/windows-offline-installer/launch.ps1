param([string]$InstallRoot = $PSScriptRoot, [int]$Port = 3200, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
. (Join-Path $InstallRoot 'common.ps1')
$stateRoot = Connect-LoudData $InstallRoot
$serverRoot = Join-Path $InstallRoot 'app'
$node = Join-Path $InstallRoot 'runtime\node.exe'
$logs = Join-Path $stateRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$env:CROWD_DATA_ROOT = $stateRoot
$env:CROWD_ANALYSIS_RUNTIME = Join-Path $InstallRoot 'analysis'
$env:CROWD_DEMUCS_BACKEND = 'windows'
$env:CROWD_SECTION_ANALYSIS = 'disabled'
$env:CROWD_ANALYSIS_THREADS = '3'
$env:CROWD_DEMUCS_IDLE_THREADS = '3'
$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:PORT = [string]$Port
$env:HOSTNAME = '0.0.0.0'
if (Test-Path -LiteralPath (Join-Path $stateRoot 'music-folder.txt')) {
  $env:CROWD_ELEMENTS_ROOT = (Get-Content -LiteralPath (Join-Path $stateRoot 'music-folder.txt') -Raw).Trim()
}
$pidFile = Join-Path $stateRoot 'server.json'
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $owned = $false
  if (Test-Path -LiteralPath $pidFile) {
    $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)" -ErrorAction SilentlyContinue
    $owned = $process -and $process.ExecutablePath -eq $node -and $process.CommandLine.Contains($serverRoot) -and @($existing.OwningProcess) -contains $saved.pid
  }
  if (-not $owned) { throw "Port $Port is being used by another program. Loud did not stop it." }
} else {
  & $node (Join-Path $InstallRoot 'spawn-server.mjs') $serverRoot $logs $pidFile
  if ($LASTEXITCODE -ne 0) { throw 'Loud could not start its background server.' }
}
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/dj" -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw "Loud did not become ready. Check $logs\booth.err.log." }
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/dj" }
