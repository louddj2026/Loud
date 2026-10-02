param(
  [int]$ParentPid = 0
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CrowdPower {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint flags);
}
"@

$continuous = [Convert]::ToUInt32("80000000", 16)
$systemRequired = [uint32]0x00000001
$displayRequired = [uint32]0x00000002
$required = $continuous -bor $systemRequired -bor $displayRequired

try {
  while ($true) {
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
      break
    }
    [CrowdPower]::SetThreadExecutionState($required) | Out-Null
    Start-Sleep -Seconds 30
  }
}
finally {
  [CrowdPower]::SetThreadExecutionState($continuous) | Out-Null
}
