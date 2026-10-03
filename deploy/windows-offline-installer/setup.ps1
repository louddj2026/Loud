param([string]$InstallRoot = $PSScriptRoot, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
. (Join-Path $InstallRoot 'common.ps1')
$stateRoot = Connect-LoudData $InstallRoot
$logs = Join-Path $stateRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'installation.log'
Start-Transcript -Path $log -Append | Out-Null
try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Loud requires 64-bit Windows.' }
  $manifest = Get-Content -LiteralPath (Join-Path $InstallRoot 'payload-manifest.json') -Raw | ConvertFrom-Json
  foreach ($item in $manifest.files) {
    if ($item.file -eq 'analysis/env/pyvenv.cfg') { continue }
    $file = [IO.Path]::GetFullPath((Join-Path $InstallRoot $item.file))
    if (-not $file.StartsWith($InstallRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid package path.' }
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed file: $($item.file)" }
    if ((Get-LoudSha256 $file) -ne $item.sha256) {
      throw "Installed file failed verification: $($item.file)"
    }
  }

  $analysisRoot = Join-Path $InstallRoot 'analysis'
  $pythonHome = Join-Path $analysisRoot 'python\cpython-3.12.10-windows-x86_64-none'
  $venvConfig = Join-Path $analysisRoot 'env\pyvenv.cfg'
  $configText = Get-Content -LiteralPath $venvConfig -Raw
  $configText = [Regex]::Replace($configText, '(?m)^home\s*=.*$', "home = $pythonHome")
  [IO.File]::WriteAllText($venvConfig, $configText.TrimEnd() + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))

  $downloads = Get-Content -LiteralPath (Join-Path $InstallRoot 'downloads.json') -Raw | ConvertFrom-Json
  $checkpointDir = Join-Path $analysisRoot 'torch\hub\checkpoints'
  $checkpoint = Join-Path $checkpointDir $downloads.demucsCheckpoint.file
  New-Item -ItemType Directory -Force -Path $checkpointDir | Out-Null
  $validCheckpoint = (Test-Path -LiteralPath $checkpoint -PathType Leaf) -and ((Get-LoudSha256 $checkpoint) -eq $downloads.demucsCheckpoint.sha256)
  if (-not $validCheckpoint) {
    $partial = "$checkpoint.partial"
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    Write-Host 'Downloading the official Demucs analysis checkpoint (about 80 MiB). Its author does not permit Loud to republish it inside this installer.'
    Invoke-WebRequest -UseBasicParsing -Uri $downloads.demucsCheckpoint.url -OutFile $partial
    if ((Get-Item -LiteralPath $partial).Length -ne [long]$downloads.demucsCheckpoint.bytes) { throw 'The Demucs checkpoint download has the wrong size.' }
    if ((Get-LoudSha256 $partial) -ne $downloads.demucsCheckpoint.sha256) { throw 'The Demucs checkpoint download failed verification.' }
    Move-Item -LiteralPath $partial -Destination $checkpoint -Force
  }

  $node = Join-Path $InstallRoot 'runtime\node.exe'
  $uv = Join-Path $InstallRoot 'runtime\uv.exe'
  $env:CROWD_ANALYSIS_RUNTIME = $analysisRoot
  $env:TORCH_HOME = Join-Path $analysisRoot 'torch'
  Push-Location -LiteralPath (Join-Path $InstallRoot 'app')
  try {
    & $node 'scripts\setup-analysis-runtime.mjs' --check --root $analysisRoot --python-dir (Join-Path $analysisRoot 'python') --uv $uv
    if ($LASTEXITCODE -ne 0) { throw 'The bundled beat/drum analysis runtime did not verify.' }
  } finally { Pop-Location }

  @{
    schema = 1
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
    installRoot = $InstallRoot
    analysisRoot = $analysisRoot
    demucsCheckpoint = $downloads.demucsCheckpoint.sha256
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $analysisRoot 'runtime.json') -Encoding UTF8
  @{ schema = 1; booth = $true; nativeAnalysis = 'verified'; audioBridge = 'included' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot 'installation-status.json') -Encoding UTF8
  & (Join-Path $InstallRoot 'verify.ps1') -InstallRoot $InstallRoot
  if ($LASTEXITCODE -ne 0) { throw 'Loud installation verification failed.' }
  Write-Host 'Loud is installed. Add your own music after the booth opens.'
  if (-not $NoLaunch) { & (Join-Path $InstallRoot 'launch.ps1') -InstallRoot $InstallRoot }
} catch {
  Write-Error $_.Exception.Message
  throw
} finally {
  Stop-Transcript | Out-Null
}
