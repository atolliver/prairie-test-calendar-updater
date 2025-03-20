Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c python C:\Users\Alex\StudioProjects\prairie-test-calendar-updater\Backend\flask_server.py", 0, False
Set WshShell = Nothing
