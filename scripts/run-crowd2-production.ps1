param(
  [string]$NodePath = "",

  [string]$ServerRoot = "",

  [string]$StdoutPath = "",

  [string]$StderrPath = ""
)

$ErrorActionPreference = "Stop"
$crowdRoot = Split-Path -Parent $PSScriptRoot
$localCrowd = Join-Path $env:LOCALAPPDATA "Crowd2"
$runtime = Join-Path $localCrowd "logs"
$installedServerRoot = Join-Path $localCrowd "runtime\standalone"
$projectServerRoot = Join-Path $crowdRoot ".next\standalone\project"

if (-not $NodePath) {
  $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  $NodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } elseif ($systemNode) { $systemNode.Source } else { throw "Node.js was not found." }
}
if (-not $ServerRoot) {
  if (Test-Path -LiteralPath (Join-Path $installedServerRoot "server.js")) {
    $ServerRoot = $installedServerRoot
  } elseif (Test-Path -LiteralPath (Join-Path $projectServerRoot "server.js")) {
    $ServerRoot = $projectServerRoot
  } else {
    throw "Crowd2 has no production server bundle. Run the production build before starting port 3200."
  }
}
if (-not $StdoutPath) { $StdoutPath = Join-Path $runtime "crowd2-this-pc.out.log" }
if (-not $StderrPath) { $StderrPath = Join-Path $runtime "crowd2-this-pc.err.log" }

New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$usingProjectBuild = [IO.Path]::GetFullPath($ServerRoot).TrimEnd('\') -eq [IO.Path]::GetFullPath($projectServerRoot).TrimEnd('\')
if ($usingProjectBuild) {
  $projectLinks = @(
    @{ Link = Join-Path $ServerRoot "public"; Target = Join-Path $crowdRoot "public" },
    @{ Link = Join-Path $ServerRoot "data"; Target = Join-Path $crowdRoot "data" },
    @{ Link = Join-Path $ServerRoot "lib"; Target = Join-Path $crowdRoot "lib" },
    @{ Link = Join-Path $ServerRoot ".next\static"; Target = Join-Path $crowdRoot ".next\static" }
  )
  foreach ($item in $projectLinks) {
    New-Item -ItemType Directory -Force -Path $item.Target | Out-Null
    if (-not (Test-Path -LiteralPath $item.Link)) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $item.Link) | Out-Null
      New-Item -ItemType Junction -Path $item.Link -Target $item.Target | Out-Null
    }
  }
} else {
  $runtimeLib = Join-Path $ServerRoot "lib"
  $buildLib = Join-Path $localCrowd "build\lib"
  if ((-not (Test-Path -LiteralPath $runtimeLib)) -and (Test-Path -LiteralPath $buildLib)) {
    New-Item -ItemType Junction -Path $runtimeLib -Target $buildLib | Out-Null
  }
  $runtimeData = Join-Path $ServerRoot "data"
  $durableData = Join-Path $localCrowd "data"
  New-Item -ItemType Directory -Force -Path $durableData | Out-Null
  if (-not (Test-Path -LiteralPath $runtimeData)) {
    New-Item -ItemType Junction -Path $runtimeData -Target $durableData | Out-Null
  }
}
$env:PORT = "3200"
$env:HOSTNAME = "0.0.0.0"
$env:NODE_ENV = "production"
$env:CROWD_DATA_ROOT = if ($env:CROWD_DATA_ROOT) { $env:CROWD_DATA_ROOT } elseif ($usingProjectBuild) { Join-Path $crowdRoot "data" } else { $localCrowd }
$env:CROWD_ANALYSIS_THREADS = if ($env:CROWD_ANALYSIS_THREADS) { $env:CROWD_ANALYSIS_THREADS } else { "3" }
$env:CROWD_ANALYSIS_IDLE_MS = if ($env:CROWD_ANALYSIS_IDLE_MS) { $env:CROWD_ANALYSIS_IDLE_MS } else { "14400000" }
if (-not $env:NODE_OPTIONS) { $env:NODE_OPTIONS = "--max-old-space-size=512" }
if (-not $env:NODE_NO_WARNINGS) { $env:NODE_NO_WARNINGS = "1" }

# The shared native analysis runtime (Beat This + Demucs, lib/analysis-runtime.ts)
# lives at a physical path every process can see; the older per-user envs are
# only a fallback for a PC that does not have it yet.
$analysisRuntime = Join-Path (Split-Path -Parent $crowdRoot) "Codex\runtimes\crowd2-analysis"
if ((-not $env:CROWD_ANALYSIS_RUNTIME) -and (Test-Path -LiteralPath (Join-Path $analysisRuntime "env\Scripts\python.exe"))) { $env:CROWD_ANALYSIS_RUNTIME = $analysisRuntime }
if (-not $env:CROWD_ANALYSIS_RUNTIME) {
  $bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  $analysisPython = Join-Path $localCrowd "analysis-env\Scripts\python.exe"
  $analysisPackages = Join-Path $localCrowd "analysis-env\Lib\site-packages"
  if (-not $env:BEAT_THIS_PYTHON) {
    if (Test-Path -LiteralPath $analysisPython) { $env:BEAT_THIS_PYTHON = $analysisPython }
    elseif (Test-Path -LiteralPath $bundledPython) { $env:BEAT_THIS_PYTHON = $bundledPython }
  }
  if ((-not $env:BEAT_THIS_PACKAGES) -and (Test-Path -LiteralPath (Join-Path $analysisPackages "beat_this"))) { $env:BEAT_THIS_PACKAGES = $analysisPackages }
}

$listeners = netstat -ano -p TCP | Select-String "^\s*TCP\s+\S+:3200\s+\S+\s+LISTENING\s+\d+"
if ($listeners) {
  $listenerPids = @($listeners | ForEach-Object {
    if ($_.Line -match "LISTENING\s+(\d+)") { [int]$Matches[1] }
  } | Sort-Object -Unique)
  throw "Crowd2 production did not start because port 3200 is already owned by PID(s): $($listenerPids -join ', '). Stop that server first; development belongs on port 3201."
}

Set-Location -LiteralPath $ServerRoot
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$serverEntry = Join-Path $ServerRoot "server.js"
$serverCommand = "`"$NodePath`" `"$serverEntry`" 1>> `"$StdoutPath`" 2>> `"$StderrPath`""
& $env:ComSpec /d /s /c $serverCommand
$serverExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference

if ($serverExitCode -ne 0) {
  throw "Crowd2 production stopped with exit code $serverExitCode. Check $StderrPath."
}
