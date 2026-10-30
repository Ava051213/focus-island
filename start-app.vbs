Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdFile = scriptDir & "\start-app.cmd"
If Not fso.FileExists(cmdFile) Then
    MsgBox "Launcher not found: " & vbCrLf & cmdFile, 16, "FocusIsland"
    WScript.Quit 1
End If
sh.Run "cmd.exe /c """ & cmdFile & """", 0, False
