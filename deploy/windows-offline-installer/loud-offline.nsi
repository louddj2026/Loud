Unicode True
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
Name "Loud"
OutFile "${OUTPUT}\Loud-Offline-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Loud"
InstallDirRegKey HKCU "Software\Loud" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetDateSave off
BrandingText "Loud"
ShowInstDetails show
ShowUninstDetails show
!define MUI_WELCOMEPAGE_TITLE "Install Loud"
!define MUI_WELCOMEPAGE_TEXT "This single installer contains Loud, Node.js, Python, FFmpeg/FFprobe, Beat This, PyTorch, Demucs code, the Beat This model, and the native audio bridge.$\r$\n$\r$\nDuring setup it downloads one official Demucs checkpoint (about 80 MiB) because its author does not permit Loud to republish that model file. No separate programs or setup commands are required.$\r$\n$\r$\nYour music is not included and stays in the folder you choose. DJ hardware drivers remain supplied by the hardware manufacturer."
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Loud"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchLoud
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
Var SetupResult

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Loud requires 64-bit Windows."
    Abort
  ${EndIf}
FunctionEnd

Section "Loud"
  SectionIn RO
  IfFileExists "$INSTDIR\stop.ps1" 0 +2
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\stop.ps1" -DetachData' $SetupResult
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  WriteRegStr HKCU "Software\Loud" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall-Loud.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loud" "DisplayName" "Loud"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loud" "UninstallString" '$\"$INSTDIR\Uninstall-Loud.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loud" "DisplayVersion" "0.1.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loud" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loud" "NoRepair" 1
  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\Loud"
  CreateShortCut "$SMPROGRAMS\Loud\Open Loud.lnk" "$SYSDIR\wscript.exe" '$\"$INSTDIR\launch-hidden.vbs$\"'
  CreateShortCut "$SMPROGRAMS\Loud\Start DJ audio bridge.lnk" "$SYSDIR\wscript.exe" '$\"$INSTDIR\audio-bridge-hidden.vbs$\"'
  CreateShortCut "$SMPROGRAMS\Loud\Choose music folder.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\select-music.ps1"'
  CreateShortCut "$SMPROGRAMS\Loud\Check installation.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\verify.ps1"'
  CreateShortCut "$SMPROGRAMS\Loud\Stop Loud.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\stop.ps1"'
  CreateShortCut "$SMPROGRAMS\Loud\Uninstall Loud.lnk" "$INSTDIR\Uninstall-Loud.exe"
  CreateShortCut "$DESKTOP\Loud.lnk" "$SYSDIR\wscript.exe" '$\"$INSTDIR\launch-hidden.vbs$\"'
  DetailPrint "Verifying the bundled runtimes and completing the official model download..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\setup.ps1" -NoLaunch' $SetupResult
  ${If} $SetupResult != 0
    SetErrorLevel 1
    DetailPrint "Loud setup did not complete. See %LOCALAPPDATA%\Loud\Data\logs\installation.log."
    Abort
  ${EndIf}
SectionEnd

Function LaunchLoud
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\launch-hidden.vbs"'
FunctionEnd

Section "Uninstall"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\stop.ps1" -DetachData' $SetupResult
  Delete "$DESKTOP\Loud.lnk"
  RMDir /r "$SMPROGRAMS\Loud"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loud"
  DeleteRegKey HKCU "Software\Loud"
  RMDir /r "$INSTDIR"
  DetailPrint "Your music and Loud library data were preserved."
SectionEnd
