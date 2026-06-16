@echo off
REM ===========================================================================
REM  Nifty Options Chain + Chart viewer - Windows launcher
REM  Put this file in the project root (next to server.py) and double-click it.
REM
REM  FIRST TIME ONLY, run this once in a terminal to clear the node_modules
REM  copied from another machine so it rebuilds for Windows:
REM       rmdir /s /q "%~dp0frontend\node_modules"
REM ===========================================================================

cd /d %~dp0

echo Starting backend on http://localhost:8000 ...
start "Nifty Backend :8000"  cmd /k "py -m pip install -r requirements.txt && py -m uvicorn server:app --port 8000"

echo Starting frontend on http://localhost:5173 ...
start "Nifty Frontend :5173" cmd /k "cd frontend && (if not exist node_modules npm install) && npm run dev"

echo Waiting for the dev server, then opening the browser...
timeout /t 12 >nul
start http://localhost:5173
