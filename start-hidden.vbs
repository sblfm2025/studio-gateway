Set objFSO = CreateObject("Scripting.FileSystemObject")
strPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strBatPath = strPath & "\start-gateway.bat"

' Dapatkan path format 8.3 (Short Path) untuk menghindari masalah spasi dan tanda kutip di Windows
strShortPath = objFSO.GetFile(strBatPath).ShortPath

Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = strPath

' Jalankan file batch secara senyap dan alihkan seluruh output lognya ke berkas vbs-run.log
objShell.Run "cmd.exe /c " & strShortPath & " > vbs-run.log 2>&1", 0, False
