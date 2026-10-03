Option Explicit
Dim shell, files, root, python, script, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
python = root & "\analysis\env\Scripts\pythonw.exe"
script = root & "\app\scripts\start-audio-bridge.py"
command = """" & python & """ """ & script & """"
shell.Run command, 0, False
