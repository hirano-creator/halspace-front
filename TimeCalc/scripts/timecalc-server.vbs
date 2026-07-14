Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """c:\dev\my-programming\TimeCalc\scripts\timecalc-server.cmd""", 0, False
Set WshShell = Nothing
