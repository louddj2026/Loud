param([string]$InstallRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$node = Join-Path $InstallRoot 'runtime\node.exe'
$python = Join-Path $InstallRoot 'analysis\env\Scripts\python.exe'
$ffmpeg = Join-Path $InstallRoot 'app\node_modules\ffmpeg-static\ffmpeg.exe'
$ffprobe = Join-Path $InstallRoot 'analysis\ffprobe\ffprobe.exe'
foreach ($file in @($node, $python, $ffmpeg, $ffprobe, (Join-Path $InstallRoot 'app\server.js'))) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed file: $file" }
}
& $node --version
if ($LASTEXITCODE -ne 0) { throw 'The bundled Node runtime could not start.' }
& $python -c 'import beat_this, demucs, numpy, sounddevice, torch, torchaudio, websockets'
if ($LASTEXITCODE -ne 0) { throw 'The bundled Python packages could not load.' }
$env:CROWD_ANALYSIS_RUNTIME = Join-Path $InstallRoot 'analysis'
$env:TORCH_HOME = Join-Path $InstallRoot 'analysis\torch'
Push-Location -LiteralPath (Join-Path $InstallRoot 'app')
try {
  & $node 'scripts\setup-analysis-runtime.mjs' --check --root $env:CROWD_ANALYSIS_RUNTIME --python-dir (Join-Path $env:CROWD_ANALYSIS_RUNTIME 'python') --uv (Join-Path $InstallRoot 'runtime\uv.exe')
  if ($LASTEXITCODE -ne 0) { throw 'Beat/drum analysis verification failed.' }
} finally { Pop-Location }
Write-Host 'Loud installation checks passed.'
