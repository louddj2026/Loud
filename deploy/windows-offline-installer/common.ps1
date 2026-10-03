$ErrorActionPreference = 'Stop'

function Get-LoudSha256([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($stream)
    ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

function Get-LoudDataRoot {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
  Join-Path $base 'Loud\Data'
}

function Connect-LoudData([string]$InstallRoot) {
  $stateRoot = Get-LoudDataRoot
  foreach ($pair in @(
    @{ Link = 'app\data'; Target = $stateRoot },
    @{ Link = 'app\public\analysis'; Target = (Join-Path $stateRoot 'analysis') }
  )) {
    $link = Join-Path $InstallRoot $pair.Link
    $target = $pair.Target
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $link), $target | Out-Null
    if (Test-Path -LiteralPath $link) {
      $item = Get-Item -LiteralPath $link -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ([IO.Path]::GetFullPath(@($item.Target)[0]).TrimEnd('\') -ne [IO.Path]::GetFullPath($target).TrimEnd('\')) {
          throw "Unexpected Loud data link: $link"
        }
        continue
      }
      if (@(Get-ChildItem -LiteralPath $link -Force).Count) { throw "Cannot replace a nonempty data folder: $link" }
      [IO.Directory]::Delete($link, $false)
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  }
  $stateRoot
}
