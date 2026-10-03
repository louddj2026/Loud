param([string]$InstallRoot = $PSScriptRoot, [string]$MusicFolder, [switch]$NoDialog)
$ErrorActionPreference = 'Stop'
. (Join-Path $InstallRoot 'common.ps1')
$stateRoot = Connect-LoudData $InstallRoot
if (-not $MusicFolder) {
  if ($NoDialog) { throw 'Supply a music folder.' }
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Choose your music folder. Loud indexes files without copying or changing them.'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
  $MusicFolder = $dialog.SelectedPath
}
$MusicFolder = [IO.Path]::GetFullPath($MusicFolder)
if (-not (Test-Path -LiteralPath $MusicFolder -PathType Container)) { throw 'The music folder does not exist.' }
$env:CROWD_ELEMENTS_ROOT = $MusicFolder
Push-Location -LiteralPath (Join-Path $InstallRoot 'app')
try {
  & (Join-Path $InstallRoot 'runtime\node.exe') 'scripts\index-elements-crate.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Music indexing failed.' }
} finally { Pop-Location }
Set-Content -LiteralPath (Join-Path $stateRoot 'music-folder.txt') -Value $MusicFolder -Encoding UTF8
