@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  echo Missing .env. Copy .env.example to .env and edit it first.
  pause
  exit /b 1
)
start "Moon Isle API" cmd /k "node server/index.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000"
endlocal
