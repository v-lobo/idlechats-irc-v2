Option Explicit

Dim fso, shell, appDir, electronExe, electronPackage, installScript, logFile
Dim versionLog, quotedLog, quotedVersionLog, versionText, versionParts, versionFile
Dim exitCode, commandLine
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")
electronPackage = fso.BuildPath(appDir, "node_modules\electron\package.json")
installScript = fso.BuildPath(appDir, "node_modules\electron\install.js")
logFile = fso.BuildPath(appDir, "install-electron.log")
versionLog = fso.BuildPath(appDir, "node-version.tmp")
quotedLog = Chr(34) & logFile & Chr(34)
quotedVersionLog = Chr(34) & versionLog & Chr(34)
shell.CurrentDirectory = appDir

exitCode = shell.Run("cmd.exe /c node --version > " & quotedVersionLog & " 2>&1", 0, True)
If exitCode <> 0 Or Not fso.FileExists(versionLog) Then
  MsgBox "Node.js nao foi encontrado. Instale Node.js 22.12 ou posterior e abra este script novamente.", vbExclamation, "IdleChats"
  WScript.Quit 1
End If

Set versionFile = fso.OpenTextFile(versionLog, 1)
versionText = Replace(Replace(Trim(versionFile.ReadAll), "v", ""), vbCr, "")
versionFile.Close
fso.DeleteFile versionLog, True
versionParts = Split(versionText, ".")
If UBound(versionParts) < 1 Then
  MsgBox "Nao foi possivel identificar a versao do Node.js. Instale Node.js 22.12 ou posterior.", vbExclamation, "IdleChats"
  WScript.Quit 1
End If
If CInt(versionParts(0)) < 22 Or (CInt(versionParts(0)) = 22 And CInt(versionParts(1)) < 12) Then
  MsgBox "Esta versao precisa do Node.js 22.12 ou posterior. Atualize o Node.js e tente novamente.", vbExclamation, "IdleChats"
  WScript.Quit 1
End If

exitCode = shell.Run("cmd.exe /c npm --version > nul 2>&1", 0, True)
If exitCode <> 0 Then
  MsgBox "O npm nao foi encontrado. Reinstale o Node.js LTS com o npm incluido e tente novamente.", vbExclamation, "IdleChats"
  WScript.Quit 1
End If

If Not fso.FileExists(electronPackage) Then
  commandLine = "cmd.exe /c npm ci > " & quotedLog & " 2>&1"
  exitCode = shell.Run(commandLine, 0, True)
  If exitCode <> 0 Or Not fso.FileExists(electronPackage) Then
    MsgBox "Nao foi possivel instalar as dependencias. Consulte install-electron.log na pasta do app.", vbExclamation, "IdleChats"
    WScript.Quit 1
  End If
End If

If Not fso.FileExists(electronExe) Then
  If Not fso.FileExists(installScript) Then
    MsgBox "Os arquivos do Electron estao incompletos. Consulte install-electron.log e tente npm ci na pasta do app.", vbExclamation, "IdleChats"
    WScript.Quit 1
  End If

  commandLine = "cmd.exe /c node " & Chr(34) & installScript & Chr(34) & " > " & quotedLog & " 2>&1"
  exitCode = shell.Run(commandLine, 0, True)
  If exitCode <> 0 Or Not fso.FileExists(electronExe) Then
    MsgBox "Nao foi possivel baixar o Electron. Consulte install-electron.log na pasta do app; a rede ou o antivirus pode ter bloqueado o download.", vbExclamation, "IdleChats"
    WScript.Quit 1
  End If
End If

shell.CurrentDirectory = appDir
shell.Run Chr(34) & electronExe & Chr(34) & " " & Chr(34) & appDir & Chr(34), 1, False
