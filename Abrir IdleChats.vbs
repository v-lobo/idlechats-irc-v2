Option Explicit

Dim fso, shell, appDir, electronExe, electronPackage, installScript, exitCode
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")
electronPackage = fso.BuildPath(appDir, "node_modules\electron\package.json")
installScript = fso.BuildPath(appDir, "node_modules\electron\install.js")

shell.CurrentDirectory = appDir

If Not fso.FileExists(electronPackage) Then
  exitCode = shell.Run("cmd.exe /c npm ci", 0, True)
  If exitCode <> 0 Or Not fso.FileExists(electronPackage) Then
    MsgBox "Não foi possível instalar as dependências. Verifique se o Node.js está instalado e tente novamente.", vbExclamation, "IdleChats"
    WScript.Quit 1
  End If
End If

If Not fso.FileExists(electronExe) Then
  If Not fso.FileExists(installScript) Then
    MsgBox "Não encontrei os arquivos do Electron. Mantenha este lançador na pasta do projeto IdleChats.", vbExclamation, "IdleChats"
    WScript.Quit 1
  End If

  exitCode = shell.Run("cmd.exe /c node " & Chr(34) & installScript & Chr(34), 0, True)

  If exitCode <> 0 Or Not fso.FileExists(electronExe) Then
    MsgBox "Não foi possível baixar o Electron. Verifique sua conexão e tente novamente.", vbExclamation, "IdleChats"
    WScript.Quit 1
  End If
End If

shell.CurrentDirectory = appDir
shell.Run Chr(34) & electronExe & Chr(34) & " " & Chr(34) & appDir & Chr(34), 1, False
