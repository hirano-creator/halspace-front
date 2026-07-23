@echo off
rem TimeCalc local launcher: health-check, start server if needed, open browser
set URL=http://localhost:3000

curl -s -o NUL --max-time 2 %URL%/login
if %errorlevel%==0 goto open

wscript "c:\dev\my-programming\TimeCalc\scripts\timecalc-server.vbs"

set /a tries=0
:wait
timeout /t 1 /nobreak >NUL
curl -s -o NUL --max-time 2 %URL%/login
if %errorlevel%==0 goto open
set /a tries+=1
if %tries% lss 30 goto wait
echo Server did not respond within 30 seconds. Check scripts\server.log
pause
exit /b 1

:open
start "" %URL%
exit /b 0
