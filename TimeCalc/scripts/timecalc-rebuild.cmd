@echo off
rem TimeCalc: rebuild and restart the port-3000 production server (next start) so source edits take effect.
cd /d c:\dev\my-programming\TimeCalc

echo [1/4] Stopping existing server on port 3000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >NUL

echo [2/4] Building...
call npm run build
if errorlevel 1 (
  echo Build failed. Aborting restart.
  exit /b 1
)

echo [3/4] Starting server...
wscript "c:\dev\my-programming\TimeCalc\scripts\timecalc-server.vbs"

echo [4/4] Waiting for server to respond...
set /a tries=0
:wait
timeout /t 1 /nobreak >NUL
curl -s -o NUL --max-time 2 http://localhost:3000/login
if %errorlevel%==0 goto ok
set /a tries+=1
if %tries% lss 30 goto wait
echo Server did not respond within 30 seconds. Check scripts\server.log
exit /b 1

:ok
echo Server is up: http://localhost:3000
exit /b 0
